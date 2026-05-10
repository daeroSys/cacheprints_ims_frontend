import { useState, useMemo, useRef, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import PageHeader from '../components/ui/PageHeader'
import StatCard from '../components/ui/StatCard'
import Modal from '../components/ui/Modal'
import { formatCurrency, formatDate, PERIOD_PRESETS, getPresetRange, inRange, toLocalISO } from '../utils/helpers'
import { generateReportHTML } from '../utils/reportGenerator'
import './PageCommon.css'
import './Reports.css'

const REPORT_TYPES = [
  { value: 'all',          label: 'Full Report' },
  { value: 'orders',       label: 'Job Order Summary' },
  { value: 'purchases',    label: 'Purchase Summary' },
  { value: 'stock',        label: 'Stock Report' },
  { value: 'transactions', label: 'Transaction Log' },
]

export default function Reports() {
  const { materials, orders, purchases, transactions } = useApp()

  // ── Period filter ──
  const [period, setPeriod] = useState('today')
  const [customFrom, setCustomFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return toLocalISO(d) })
  const [customTo, setCustomTo] = useState(() => toLocalISO(new Date()))

  const range = useMemo(() => {
    if (period === 'custom') {
      return { from: new Date(customFrom + 'T00:00:00'), to: new Date(customTo + 'T23:59:59') }
    }
    return getPresetRange(period) || getPresetRange('today')
  }, [period, customFrom, customTo])

  const rangeLabel = useMemo(() => {
    const fmt = (d) => d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
    return `${fmt(range.from)} – ${fmt(range.to)}`
  }, [range])

  // ── Filtered data ──
  const filteredOrders    = orders.filter(o => !o.isArchived && inRange(o.createdAt, range.from, range.to))
  const filteredPurchases = purchases.filter(p => p.isReceived && inRange(p.receivedAt || p.date, range.from, range.to))
  const filteredTxns      = transactions.filter(t => inRange(t.date, range.from, range.to))
  const filteredReceipts  = filteredPurchases.filter(p => p.receiptImage)

  const periodRevenue      = filteredOrders.reduce((s, o) => s + (o.paidAmount || 0), 0)
  const periodCollectibles = filteredOrders.reduce((s, o) => s + ((o.totalAmount || 0) - (o.paidAmount || 0)), 0)
  const periodPurchCost    = filteredPurchases.reduce((s, p) => s + (p.overallCost || 0), 0)

  // ── Top 5 Most Used Fabrics ──
  const topFabrics = useMemo(() => {
    const map = {}
    filteredTxns.filter(t => t.type === 'Stock-Out').forEach(t => {
      (t.items || []).forEach(it => {
        // Match fabric materials
        const mat = materials.find(m => m._id === it.materialId || m.id === it.materialId)
        if (mat && mat.category && mat.category.toLowerCase().includes('fabric')) {
          const name = it.materialName || mat.name || 'Unknown'
          map[name] = (map[name] || 0) + Math.abs(it.qty || 0)
        }
      })
    })
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [filteredTxns, materials])

  // ── Fast & Slow Moving Materials ──
  const materialMovement = useMemo(() => {
    const map = {}
    // Initialize all active materials
    materials.filter(m => !m.isArchived).forEach(m => {
      map[m.name] = { name: m.name, category: m.category, unit: m.unit, used: 0, id: m.id }
    })
    // Sum stock-out qty per material
    filteredTxns.filter(t => t.type === 'Stock-Out').forEach(t => {
      (t.items || []).forEach(it => {
        const name = it.materialName
        if (name && map[name]) {
          map[name].used += Math.abs(it.qty || 0)
        }
      })
    })
    const arr = Object.values(map)
    const sorted = arr.sort((a, b) => b.used - a.used)
    const fast = sorted.filter(m => m.used > 0).slice(0, 5)
    const slow = [...sorted].reverse().slice(0, 5)
    return { fast, slow }
  }, [filteredTxns, materials])

  // ── Inventory Value by Category ──
  const categoryTotals = materials.filter(m => !m.isArchived).reduce((acc, m) => {
    const cost = Number(m.costPerUnit) || 0
    const qty = Number(m.quantity) || 0
    const cat = m.category || 'Other'
    acc[cat] = (acc[cat] || 0) + (qty * cost)
    return acc
  }, {})
  const maxCategoryVal = Math.max(1, ...Object.values(categoryTotals).map(v => v || 0))

  // ── Purchase vs Revenue chart (simple bar chart via CSS) ──
  const maxBarVal = Math.max(1, periodRevenue, periodPurchCost, periodCollectibles)

  // ── Generate Report Modal ──
  const [genModal, setGenModal] = useState(false)
  const [viewReceipt, setViewReceipt] = useState(null)
  const [receiptSearch, setReceiptSearch] = useState('')
  const [receiptPeriod, setReceiptPeriod] = useState('this-month') // Initial state: 'this-month' to avoid clutter
  const [recCustomFrom, setRecCustomFrom] = useState(() => toLocalISO(new Date()))
  const [recCustomTo,   setRecCustomTo]   = useState(() => toLocalISO(new Date()))
  const [reportType, setReportType] = useState('all')
  const [repFrom, setRepFrom] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return toLocalISO(d) })
  const [repTo, setRepTo] = useState(() => toLocalISO(new Date()))
  const [errors, setErrors] = useState({})

  const validateReport = () => {
    const e = {}
    if (!repFrom) e.from = 'Start date is required.'
    if (!repTo) e.to = 'End date is required.'
    if (repFrom && repTo && repFrom > repTo) e.to = 'End date must be after start date.'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleGenerate = () => {
    if (!validateReport()) return
    const html = generateReportHTML({
      reportType, from: repFrom, to: repTo,
      orders: orders.filter(o => !o.isArchived),
      materials, purchases, transactions,
    })
    const w = window.open('', '_blank')
    w.document.write(html)
    w.document.close()
    setGenModal(false)
  }

  // Canvas ref for the chart
  const chartRef = useRef(null)

  useEffect(() => {
    const canvas = chartRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    const w = canvas.parentElement.offsetWidth
    const h = 200
    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = w + 'px'
    canvas.style.height = h + 'px'
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)

    const padding = { top: 20, right: 20, bottom: 40, left: 80 }
    const chartW = w - padding.left - padding.right
    const chartH = h - padding.top - padding.bottom

    const data = [
      { label: 'Revenue', value: periodRevenue, color: '#2e7d32' },
      { label: 'Collectibles', value: periodCollectibles, color: '#1565c0' },
      { label: 'Purchases', value: periodPurchCost, color: '#c62828' },
    ]
    const maxVal = Math.max(1, ...data.map(d => d.value))
    const barW = Math.min(60, chartW / data.length - 30)

    // Grid lines
    ctx.strokeStyle = '#eee'
    ctx.lineWidth = 1
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (chartH / 4) * i
      ctx.beginPath()
      ctx.moveTo(padding.left, y)
      ctx.lineTo(w - padding.right, y)
      ctx.stroke()
      // Label
      ctx.fillStyle = '#999'
      ctx.font = '11px "Segoe UI", sans-serif'
      ctx.textAlign = 'right'
      ctx.fillText(formatCurrency(maxVal - (maxVal / 4) * i), padding.left - 8, y + 4)
    }

    // Bars
    data.forEach((d, i) => {
      const x = padding.left + (chartW / data.length) * i + (chartW / data.length - barW) / 2
      const barH = (d.value / maxVal) * chartH
      const y = padding.top + chartH - barH

      // Bar gradient
      ctx.fillStyle = d.color
      ctx.beginPath()
      const r = 4
      ctx.moveTo(x + r, y)
      ctx.lineTo(x + barW - r, y)
      ctx.quadraticCurveTo(x + barW, y, x + barW, y + r)
      ctx.lineTo(x + barW, padding.top + chartH)
      ctx.lineTo(x, padding.top + chartH)
      ctx.lineTo(x, y + r)
      ctx.quadraticCurveTo(x, y, x + r, y)
      ctx.fill()

      // Value on top
      ctx.fillStyle = '#333'
      ctx.font = 'bold 11px "Segoe UI", sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(formatCurrency(d.value), x + barW / 2, y - 6)

      // Label below
      ctx.fillStyle = '#666'
      ctx.font = '12px "Segoe UI", sans-serif'
      ctx.fillText(d.label, x + barW / 2, padding.top + chartH + 20)
    })
  }, [periodRevenue, periodCollectibles, periodPurchCost])

  return (
    <div>
      <PageHeader
        title="Reports & Analytics"
        subtitle="Business performance overview and analytics"
        action={<button className="btn btn-primary" onClick={() => setGenModal(true)}>Generate Report</button>}
      />

      {/* ── Period Filter ── */}
      <div className="period-bar animate-fade-up">
        <div className="period-chips">
          {PERIOD_PRESETS.map(p => (
            <button
              key={p.key}
              className={`filter-chip ${period === p.key ? 'filter-chip--active' : ''}`}
              onClick={() => setPeriod(p.key)}
            >{p.label}</button>
          ))}
        </div>
        {period === 'custom' && (
          <div className="period-custom-range">
            <input type="date" className="form-input" style={{ width: 150, padding: '6px 10px', fontSize: 12 }} value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
            <span style={{ color: 'var(--gray-mid)', fontSize: 12 }}>to</span>
            <input type="date" className="form-input" style={{ width: 150, padding: '6px 10px', fontSize: 12 }} value={customTo} onChange={e => setCustomTo(e.target.value)} />
          </div>
        )}
        <span className="period-label">📅 {rangeLabel}</span>
      </div>

      {/* ── Stat Cards ── */}
      <div className="reports-stats animate-fade-up delay-1">
        <StatCard label="Revenue"       value={formatCurrency(periodRevenue)}   sub="Payments received"     icon="₱" delay={0} />
        <StatCard label="Collectibles"  value={formatCurrency(periodCollectibles)} sub="Remaining balances"  icon="✓" delay={60} />
        <StatCard label="Total Purchases" value={formatCurrency(periodPurchCost)} sub="Received purchases" icon="↓" delay={120} />
      </div>

      {/* ── Reports Grid ── */}
      <div className="reports-grid">

        {/* Purchase vs Revenue Chart */}
        <div className="section-card section-card--wide animate-fade-up delay-2">
          <h3 className="section-card__title">Total Purchase vs Revenue</h3>
          <div className="chart-container">
            <canvas ref={chartRef} />
          </div>
        </div>

        {/* Top 5 Most Used Fabrics */}
        <div className="section-card animate-fade-up delay-3">
          <h3 className="section-card__title">Top 5 Most Used Fabrics</h3>
          {topFabrics.length === 0
            ? <p className="reports-empty">No fabric usage data for this period.</p>
            : topFabrics.map(([name, qty], i) => (
                <div key={name} className="report-bar-row">
                  <span className="report-rank">{i + 1}</span>
                  <span className="report-bar-label">{name}</span>
                  <div className="report-bar-track">
                    <div className="report-bar-fill report-bar-fill--fabric" style={{ width: `${Math.min(100, (qty / (topFabrics[0]?.[1] || 1)) * 100)}%` }} />
                  </div>
                  <span className="report-bar-val">{Math.round(qty * 100) / 100}</span>
                </div>
              ))
          }
        </div>

        {/* Inventory Value by Category */}
        <div className="section-card animate-fade-up delay-4">
          <h3 className="section-card__title">Inventory Value by Category</h3>
          {Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]).map(([cat, val]) => (
            <div key={cat} className="report-bar-row">
              <span className="report-bar-label" style={{ width: 120 }}>{cat}</span>
              <div className="report-bar-track">
                <div className="report-bar-fill" style={{ width: `${Math.min(100, (val / maxCategoryVal) * 100)}%` }} />
              </div>
              <span className="report-bar-val">{formatCurrency(val)}</span>
            </div>
          ))}
        </div>

        {/* Fast Moving Materials */}
        <div className="section-card animate-fade-up delay-5">
          <h3 className="section-card__title">
            <span>🔥 Fast Moving Materials</span>
          </h3>
          {materialMovement.fast.length === 0
            ? <p className="reports-empty">No material movement for this period.</p>
            : materialMovement.fast.map((m, i) => (
                <div key={m.id} className="movement-row">
                  <span className="movement-rank movement-rank--fast">{i + 1}</span>
                  <div className="movement-info">
                    <p className="movement-name">{m.name}</p>
                    <p className="movement-meta">{m.category} · {m.unit}</p>
                  </div>
                  <span className="movement-used">{Math.round(m.used * 100) / 100} used</span>
                </div>
              ))
          }
        </div>

        {/* Slow Moving Materials */}
        <div className="section-card animate-fade-up delay-6">
          <h3 className="section-card__title">
            <span>🐌 Slow Moving Materials</span>
          </h3>
          {materialMovement.slow.length === 0
            ? <p className="reports-empty">No data available.</p>
            : materialMovement.slow.map((m, i) => (
                <div key={m.id} className="movement-row">
                  <span className="movement-rank movement-rank--slow">{i + 1}</span>
                  <div className="movement-info">
                    <p className="movement-name">{m.name}</p>
                    <p className="movement-meta">{m.category} · {m.unit}</p>
                  </div>
                  <span className="movement-used movement-used--slow">{m.used === 0 ? 'No usage' : `${Math.round(m.used * 100) / 100} used`}</span>
                </div>
              ))
          }
        </div>

        {/* Delivery Receipts Gallery */}
        <div className="section-card section-card--wide animate-fade-up delay-7">
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16, flexWrap:'wrap', gap:12 }}>
            <div>
              <h3 className="section-card__title" style={{ marginBottom:4 }}>Delivery Receipts</h3>
              <p style={{ fontSize:11, color:'var(--gray-mid)' }}>View and search all proof of delivery photos</p>
            </div>
            <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
              {receiptPeriod === 'custom' && (
                <div style={{ display:'flex', gap:4, alignItems:'center', marginRight:8 }}>
                  <input type="date" className="form-input" style={{ width:125, padding:'4px 8px', fontSize:11 }} value={recCustomFrom} onChange={e => setRecCustomFrom(e.target.value)} />
                  <span style={{ fontSize:11, color:'var(--gray-mid)' }}>–</span>
                  <input type="date" className="form-input" style={{ width:125, padding:'4px 8px', fontSize:11 }} value={recCustomTo} onChange={e => setRecCustomTo(e.target.value)} />
                </div>
              )}
              <select 
                className="form-select" 
                style={{ width:140, padding:'5px 10px', fontSize:12, height:32 }} 
                value={receiptPeriod} 
                onChange={e => setReceiptPeriod(e.target.value)}
              >
                <option value="page">Sync with Page</option>
                <option value="this-week">This Week</option>
                <option value="this-month">This Month</option>
                <option value="custom">Custom Range</option>
              </select>
              <input 
                className="toolbar-search" 
                placeholder="Search ID or Date…" 
                style={{ width:180, padding:'6px 12px', fontSize:12, height:32 }}
                value={receiptSearch}
                onChange={e => setReceiptSearch(e.target.value)}
              />
            </div>
          </div>
          {(() => {
            // Determine the base set of receipts to show
            let base = []
            if (receiptPeriod === 'page') {
              base = filteredReceipts
            } else {
              const r = receiptPeriod === 'custom' 
                ? { from: new Date(recCustomFrom + 'T00:00:00'), to: new Date(recCustomTo + 'T23:59:59') }
                : getPresetRange(receiptPeriod)
              base = purchases.filter(p => p.receiptImage && p.isReceived && inRange(p.receivedAt || p.date, r.from, r.to))
            }

            const searched = base.filter(p => {
              if (!receiptSearch.trim()) return true
              const s = receiptSearch.toLowerCase()
              return (p.purchaseId || p.id).toLowerCase().includes(s) || 
                     formatDate(p.receivedAt || p.date).toLowerCase().includes(s)
            })

            return (
              <>
                {base.length === 0 ? (
                  <p className="reports-empty">No delivery receipts for this period.</p>
                ) : (
                  <div className="receipts-list">
                    {searched.map(p => (
                      <button key={p.id} className="receipt-link-chip" onClick={() => setViewReceipt(p)}>
                        <span className="receipt-link-id">{p.purchaseId || p.id}</span>
                        <span className="receipt-link-date">{formatDate(p.receivedAt || p.date)}</span>
                      </button>
                    ))}
                    {searched.length === 0 && receiptSearch && (
                      <p className="reports-empty" style={{ width:'100%' }}>No receipts match your search.</p>
                    )}
                  </div>
                )}
              </>
            )
          })()}
        </div>
      </div>

      {/* Generate Report Modal */}
      <Modal open={genModal} onClose={() => setGenModal(false)} title="Generate Report" size="sm">
        <div className="form-group">
          <label className="form-label">Report Type</label>
          <select className="form-select" value={reportType} onChange={e => setReportType(e.target.value)}>
            {REPORT_TYPES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">From Date *</label>
            <input className={`form-input ${errors.from ? 'input-error' : ''}`} type="date" value={repFrom} onChange={e => setRepFrom(e.target.value)} />
            {errors.from && <p className="field-error">{errors.from}</p>}
          </div>
          <div className="form-group">
            <label className="form-label">To Date *</label>
            <input className={`form-input ${errors.to ? 'input-error' : ''}`} type="date" value={repTo} onChange={e => setRepTo(e.target.value)} />
            {errors.to && <p className="field-error">{errors.to}</p>}
          </div>
        </div>
        <p style={{ fontSize: 12, color: 'var(--gray-mid)', marginBottom: 8, lineHeight: 1.5 }}>
          A print-ready report opens in a new tab. Use your browser's print dialog to save as PDF.
        </p>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={() => setGenModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleGenerate}>Generate &amp; Open</button>
        </div>
      </Modal>

      <Modal open={!!viewReceipt} onClose={() => setViewReceipt(null)} title={`Delivery Receipt — ${viewReceipt?.purchaseId || viewReceipt?.id}`} size="md">
        {viewReceipt && (
          <div className="receipt-viewer-modal">
             <div className="receipt-image-scroll-container">
                <img src={viewReceipt.receiptImage} alt="receipt" className="receipt-viewer-img" />
             </div>
             <div className="receipt-viewer-meta">
                <div className="receipt-meta-item">
                   <span className="receipt-meta-label">Date Received</span>
                   <span className="receipt-meta-value">{formatDate(viewReceipt.receivedAt || viewReceipt.date)}</span>
                </div>
                <div className="receipt-meta-item" style={{ textAlign:'right' }}>
                   <span className="receipt-meta-label">Total Cost</span>
                   <span className="receipt-meta-value">{formatCurrency(viewReceipt.overallCost)}</span>
                </div>
             </div>
             <div className="modal-actions" style={{ marginTop:8 }}>
                <button className="btn btn-secondary" onClick={() => setViewReceipt(null)}>Close</button>
             </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
