import { useState, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import StatCard from '../components/ui/StatCard'
import Badge from '../components/ui/Badge'
import PageHeader from '../components/ui/PageHeader'
import { formatCurrency, formatDate, getStatusColor, PERIOD_PRESETS, getPresetRange, inRange, toLocalISO } from '../utils/helpers'
import './Dashboard.css'

export default function Dashboard({ onNav }) {
  const { materials, orders, purchases, transactions, lowStockItems } = useApp()

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

  // ── Scoped data ──
  const periodOrders    = orders.filter(o => !o.isArchived && inRange(o.createdAt, range.from, range.to))
  const periodPurchases = purchases.filter(p => p.isReceived && inRange(p.receivedAt || p.date, range.from, range.to))
  const periodRevenue      = periodOrders.reduce((s, o) => s + (o.paidAmount || 0), 0)
  const periodCollectibles = periodOrders.reduce((s, o) => s + ((o.totalAmount || 0) - (o.paidAmount || 0)), 0)
  const periodPurchCost    = periodPurchases.reduce((s, p) => s + (p.overallCost || 0), 0)

  // ── Period transactions ──
  const periodTxns = transactions.filter(t => inRange(t.date, range.from, range.to))
  const recentTxns = periodTxns.slice(0, 6)

  // ── Stock movement ──
  const stockOutMap = useMemo(() => {
    const map = {}
    periodTxns.filter(t => t.type === 'Stock-Out').forEach(t => {
      (t.items || []).forEach(it => {
        const name = it.materialName || 'Unknown'
        map[name] = (map[name] || 0) + Math.abs(it.qty || 0)
      })
    })
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [periodTxns])

  const stockInMap = useMemo(() => {
    const map = {}
    periodTxns.filter(t => t.type === 'Stock-In').forEach(t => {
      (t.items || []).forEach(it => {
        const name = it.materialName || 'Unknown'
        map[name] = (map[name] || 0) + Math.abs(it.qty || 0)
      })
    })
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [periodTxns])

  return (
    <div className="dashboard">
      <PageHeader
        title="Overview"
        subtitle="Key metrics and notifications"
      />

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

      <div className="dashboard__stats">
        <StatCard
          label="Revenue"
          value={formatCurrency(periodRevenue)}
          sub="Payments received"
          icon="₱" delay={0}
        />
        <StatCard
          label="Collectibles"
          value={formatCurrency(periodCollectibles)}
          sub="Remaining balances"
          icon="✓" delay={60}
        />
        <StatCard
          label="Purchases"
          value={formatCurrency(periodPurchCost)}
          sub={`${periodPurchases.length} received`}
          icon="⊕" delay={60}
        />
        <StatCard
          label="Materials"
          value={materials.filter(m => !m.isArchived).length}
          sub={`${lowStockItems.length} require restocking`}
          icon="⬡" delay={120}
        />
      </div>

      <div className="dashboard__grid">
        {/* Low Stock Alerts */}
        <div className="dash-card animate-fade-up delay-3">
          <div className="dash-card__head">
            <h3 className="dash-card__title">Low Stock Alerts</h3>
            <button className="dash-card__link" onClick={() => onNav('stock')}>View all →</button>
          </div>
          {lowStockItems.length === 0
            ? <p className="dash-empty">✓ All materials sufficiently stocked</p>
            : <div className="alert-list">
                {lowStockItems.slice(0, 5).map(mat => {
                  const maxLvl = Math.max(mat.maxLevel || mat.maxQty || 1, 1)
                  const isCrit = mat.status === 'Critical'
                  return (
                    <div key={mat.id} className="alert-item">
                      <div className="alert-item__info">
                        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                          <p className={`alert-item__name alert-item__name--${mat.status.toLowerCase()}`}>{mat.name || 'Unnamed Material'}</p>
                          <Badge status={isCrit ? 'status-red' : 'status-orange'}>{mat.status}</Badge>
                        </div>
                        <p className={`alert-item__detail alert-item__detail--${mat.status.toLowerCase()}`}>{mat.effectiveStock} {mat.unit} available (Lead time: {mat.leadTime || 0}d)</p>
                      </div>
                      <div className={`alert-item__bar alert-item__bar--${mat.status.toLowerCase()}`}>
                        <div className={`alert-item__bar-fill alert-item__bar-fill--${mat.status.toLowerCase()}`} style={{ width: `${Math.min(100, Math.max(0, (mat.effectiveStock / maxLvl) * 100))}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
          }
        </div>

        {/* Recent Transactions */}
        <div className="dash-card animate-fade-up delay-4">
          <div className="dash-card__head">
            <h3 className="dash-card__title">Recent Transactions</h3>
            <button className="dash-card__link" onClick={() => onNav('transactions')}>View all →</button>
          </div>
          <div className="txn-list">
            {recentTxns.length === 0 && <p className="dash-empty">No transactions found</p>}
            {recentTxns.map(txn => (
              <div key={txn.id} className="txn-item">
                <div className={`txn-item__dot txn-item__dot--${txn.type === 'Stock-In' ? 'in' : txn.type === 'Stock-Out' ? 'out' : 'adj'}`} />
                <div className="txn-item__info">
                  <p className="txn-item__name">{(txn.items || [])[0]?.materialName || '—'}</p>
                  <p className="txn-item__meta">{txn.type} · {formatDate(txn.date)}</p>
                </div>
                <span className={`txn-item__qty ${txn.type === 'Stock-In' ? 'txn-item__qty--in' : 'txn-item__qty--out'}`}>
                  {txn.type === 'Stock-In' ? '+' : ''}{(txn.items || [])[0]?.qty ?? ''}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Stock Out */}
        <div className="dash-card animate-fade-up delay-5">
          <div className="dash-card__head">
            <h3 className="dash-card__title">Stock Out</h3>
          </div>
          {stockOutMap.length === 0
            ? <p className="dash-empty">No stock-out movement</p>
            : <div className="dash-movement-list">
                {stockOutMap.map(([name, qty]) => (
                  <div key={name} className="dash-movement-row">
                    <span className="dash-movement-name">{name}</span>
                    <div className="dash-movement-bar-track">
                      <div className="dash-movement-bar-fill dash-movement-bar-fill--out" style={{ width: `${Math.min(100, (qty / (stockOutMap[0]?.[1] || 1)) * 100)}%` }} />
                    </div>
                    <span className="dash-movement-val">-{Math.round(qty * 100) / 100}</span>
                  </div>
                ))}
              </div>
          }
        </div>

        {/* Stock In */}
        <div className="dash-card animate-fade-up delay-6">
          <div className="dash-card__head">
            <h3 className="dash-card__title">Stock In</h3>
          </div>
          {stockInMap.length === 0
            ? <p className="dash-empty">No stock-in movement</p>
            : <div className="dash-movement-list">
                {stockInMap.map(([name, qty]) => (
                  <div key={name} className="dash-movement-row">
                    <span className="dash-movement-name">{name}</span>
                    <div className="dash-movement-bar-track">
                      <div className="dash-movement-bar-fill dash-movement-bar-fill--in" style={{ width: `${Math.min(100, (qty / (stockInMap[0]?.[1] || 1)) * 100)}%` }} />
                    </div>
                    <span className="dash-movement-val">+{Math.round(qty * 100) / 100}</span>
                  </div>
                ))}
              </div>
          }
        </div>
      </div>
    </div>
  )
}
