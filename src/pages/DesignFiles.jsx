import { useState, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import PageHeader from '../components/ui/PageHeader'
import Badge from '../components/ui/Badge'
import Modal from '../components/ui/Modal'
import Pagination from '../components/ui/Pagination'
import { usePagination } from '../hooks/usePagination'
import { formatDate, formatCurrency, getStatusColor } from '../utils/helpers'
import { printJobOrderSheet } from '../utils/jobOrderSheetPrint'
import './PageCommon.css'
import './DesignFiles.css'

import { PERIOD_PRESETS, getPresetRange, inRange, toLocalISO } from '../utils/helpers'

export default function DesignFiles() {
  const { orders, updateOrder } = useApp()
  const [tab, setTab] = useState('ongoing')
  const [search, setSearch] = useState('')

  // ── Period filter ──
  const [period, setPeriod] = useState('today')
  const [customFrom, setCustomFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return toLocalISO(d) })
  const [customTo, setCustomTo] = useState(() => toLocalISO(new Date()))
  const [previewFile, setPreviewFile] = useState(null); // { name, url }
  const [sheetModal, setSheetModal] = useState(null); // order object


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

  const [editModal, setEditModal] = useState(null)
  const [editForm, setEditForm] = useState({ name: '', url: '', notes: '' })
  const [editErrors, setEditErrors] = useState({})

  // Base: all non-archived orders sorted latest → oldest
  const allOrders = useMemo(() =>
    [...orders]
      .filter(o => !o.isArchived)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    [orders]
  )

  const ongoingOrders = allOrders.filter(o => o.status !== 'completed' && !o.isCompleted)
  const completedOrders = allOrders.filter(o => o.status === 'completed' || o.isCompleted)

  const applyFilters = (list, isCompletedTab = false) => {
    return list.filter(o => {
      const term = search.toLowerCase().trim()
      const matchSearch =
        !term ||
        o.customer.toLowerCase().includes(term) ||
        (o.teamName || '').toLowerCase().includes(term) ||
        (o.orderId || '').toLowerCase().includes(term) ||
        (o.design || '').toLowerCase().includes(term)

      const dateToCompare = isCompletedTab ? (o.completedAt || o.updatedAt) : o.createdAt
      const matchDate = inRange(dateToCompare, range.from, range.to)
      return matchSearch && matchDate
    })
  }

  const filteredOngoing = applyFilters(ongoingOrders, false)
  const filteredCompleted = applyFilters(completedOrders, true)

  const pgOngoing = usePagination(filteredOngoing, 10)
  const pgCompleted = usePagination(filteredCompleted, 10)

  const displayStatus = (order) => (order.status === 'completed' || order.isCompleted) ? 'Completed' : order.status

  const statusForBadge = (status) => {
    if (status === 'Completed') return 'status-green'
    return getStatusColor(status)
  }

  const openEdit = (order, file) => {
    setEditModal({ order, fileId: file.id })
    setEditForm({ name: file.name, url: file.url || '', notes: file.notes || '' })
    setEditErrors({})
  }

  const handleSaveEdit = () => {
    const e = {}
    if (!editForm.name.trim()) e.name = 'File name is required.'
    if (editForm.url && editForm.url.trim() && !editForm.url.startsWith('http')) e.url = 'URL must start with http:// or https://'
    setEditErrors(e)
    if (Object.keys(e).length > 0) return
    const { order, fileId } = editModal
    const updatedFiles = (order.designFiles || []).map(f =>
      f.id === fileId ? { ...f, name: editForm.name, url: editForm.url, notes: editForm.notes } : f
    )
    updateOrder(order.id, { designFiles: updatedFiles })
    setEditModal(null)
  }

  const handleRemoveFile = (order, fileId) => {
    const updatedFiles = (order.designFiles || []).filter(f => f.id !== fileId)
    updateOrder(order.id, { designFiles: updatedFiles })
  }

  const totalOngoing = ongoingOrders.reduce((s, o) => s + (o.designFiles?.length || 0), 0)
  const totalCompleted = completedOrders.reduce((s, o) => s + (o.designFiles?.length || 0), 0)

  const isImage = (url) => {
    if (!url) return false;
    return url.startsWith('data:image/') || /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(url);
  };

  const handleFileClick = (e, file) => {
    if (isImage(file.url)) {
      e.preventDefault();
      setPreviewFile(file);
    }
  };

  const renderOrderCard = (order, i) => {
    const showSheet = !['Order Received', 'Designing'].includes(order.status)
    const synthesizedFiles = [
      ...(order.designFiles || []),
      ...(showSheet ? [{ id: 'jo-sheet', name: 'Job Order Sheet', url: null, type: 'sheet', notes: 'System Generated', uploadedAt: order.updatedAt, isJOS: true }] : []),
      ...(order.paymentReceipt ? [{ id: 'dp-receipt', name: 'Design Fee', url: order.paymentReceipt, type: 'image', notes: 'Payment confirmed by Admin', uploadedAt: order.paymentReceiptDate || order.updatedAt, isJOS: true }] : []),
      ...(order.finalPaymentReceipt ? [{ id: 'fp-receipt', name: 'Payment for Remaining Balance', url: order.finalPaymentReceipt, type: 'image', notes: 'Final payment confirmed', uploadedAt: order.finalPaymentReceiptDate || order.updatedAt, isJOS: true }] : [])
    ]

    const files = synthesizedFiles
    const status = displayStatus(order)
    return (
      <div key={order.id} className="df-card" style={{ animationDelay: `${i * 40}ms` }}>
        <div className="df-card__head">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <p className="df-card__id">{order.orderId}</p>
            <span style={{ fontWeight: 700, color: 'var(--gray-dark)', fontSize: 13 }}>{order.customerName || order.customer}</span>
            {order.teamName && <span style={{ fontSize: 11, color: 'var(--gray-mid)' }}>Team: {order.teamName}</span>}
            {order.productType && <span style={{ fontSize: 10, color: 'var(--primary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>{order.productType}</span>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <Badge status={statusForBadge(status)}>{status}</Badge>
            <span style={{ fontSize: 11, color: 'var(--gray-light)' }}>{formatDate(tab === 'completed' ? (order.completedAt || order.updatedAt) : order.createdAt)}</span>
          </div>
        </div>

        <p className="df-card__design">
          <span className="df-card__design-icon">✎</span>
          {order.design || <em style={{ color: 'var(--gray-light)' }}>No design description</em>}
        </p>

        <div className="df-card__files">
          {files.length === 0 ? (
            <div className="df-card__no-files"><span>No files attached yet</span></div>
          ) : (
            files.map(f => {
              const isVirtual = ['dp-receipt', 'final-design', 'fp-receipt', 'jo-sheet', 'logo-image'].includes(f.id)
              return (
                <div key={f.id} className="df-file-pill" style={isVirtual ? { borderLeft: '3px solid #1e40af', background: '#f8fafc' } : {}}>
                  <span className="df-file-pill__icon" style={{ color: isVirtual ? '#1e40af' : 'inherit' }}>{isVirtual ? '🔗' : '◈'}</span>
                  <div className="df-file-pill__info">
                    {f.url
                      ? <a
                        href={f.url}
                        target="_blank"
                        rel="noreferrer"
                        className="df-file-pill__name df-file-pill__name--link"
                        onClick={(e) => handleFileClick(e, f)}
                      >
                        {f.name}
                      </a>
                      : f.type === 'sheet'
                        ? <button
                          className="df-file-pill__name df-file-pill__name--link"
                          style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', font: 'inherit', cursor: 'pointer' }}
                          onClick={() => setSheetModal(order)}
                        >
                          {f.name}
                        </button>
                        : <span className="df-file-pill__name">{f.name}</span>
                    }
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {f.notes && <span className="df-file-pill__notes">{f.notes}</span>}
                      {isVirtual && <span style={{ fontSize: 7, background: '#dbeafe', color: '#1e40af', padding: '1px 5px', borderRadius: 4, fontWeight: 700, textTransform: 'uppercase' }}>Synced from JOS</span>}
                    </div>
                  </div>
                  <span className="df-file-pill__date">{formatDate(f.uploadedAt)}</span>
                  {!isVirtual && (
                    <>
                      <button className="df-file-pill__edit" onClick={() => openEdit(order, f)} title="Edit file">✎</button>
                      <button className="df-file-pill__remove" onClick={() => handleRemoveFile(order, f.id)} title="Remove file">✕</button>
                    </>
                  )}
                </div>
              )
            })
          )}
        </div>

        <div className="df-card__footer">
          <span className="df-card__file-count">{files.length} file{files.length !== 1 ? 's' : ''}</span>
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Design File Storage"
        subtitle={`${totalOngoing} files in ongoing · ${totalCompleted} files in completed — sorted latest to oldest`}
      />

      {/* Tabs */}
      <div className="oh-tabs animate-fade-up">
        <button className={`archive-tab ${tab === 'ongoing' ? 'archive-tab--active' : ''}`} onClick={() => setTab('ongoing')}>
          Ongoing Projects ({ongoingOrders.length})
        </button>
        <button className={`archive-tab ${tab === 'completed' ? 'archive-tab--active' : ''}`} onClick={() => setTab('completed')}>
          Completed ({completedOrders.length})
        </button>
      </div>

      {/* Search + Date filter */}
      <div className="page-toolbar animate-fade-up delay-1" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
        <input
          className="toolbar-search"
          style={{ width: 320 }}
          placeholder="Search customer or team name"
          value={search}
          onChange={e => { setSearch(e.target.value); pgOngoing.setPage(1); pgCompleted.setPage(1) }}
        />
        <div className="period-bar" style={{ marginBottom: 0, padding: 0, border: 'none', background: 'transparent' }}>
          <span style={{ fontSize: 12, color: 'var(--gray-mid)', fontWeight: 500, marginRight: 2 }}>{tab === 'completed' ? 'Date Completed:' : 'Date Created:'}</span>
          <div className="period-chips">
            {PERIOD_PRESETS.map(p => (
              <button
                key={p.key}
                className={`filter-chip ${period === p.key ? 'filter-chip--active' : ''}`}
                onClick={() => { setPeriod(p.key); pgOngoing.setPage(1); pgCompleted.setPage(1); }}
              >{p.label}</button>
            ))}
          </div>
          {period === 'custom' && (
            <div className="period-custom-range">
              <input type="date" className="form-input" style={{ width: 140, padding: '6px 10px', fontSize: 12 }} value={customFrom} onChange={e => { setCustomFrom(e.target.value); pgOngoing.setPage(1); pgCompleted.setPage(1); }} />
              <span style={{ color: 'var(--gray-mid)', fontSize: 12 }}>to</span>
              <input type="date" className="form-input" style={{ width: 140, padding: '6px 10px', fontSize: 12 }} value={customTo} onChange={e => { setCustomTo(e.target.value); pgOngoing.setPage(1); pgCompleted.setPage(1); }} />
            </div>
          )}
          <span className="period-label">📅 {rangeLabel}</span>
        </div>
      </div>

      {/* Ongoing Projects */}
      {tab === 'ongoing' && (
        <>
          {filteredOngoing.length === 0 ? (
            <div className="empty-state animate-fade-up">
              <div className="empty-state__icon">◈</div>
              <p className="empty-state__text">No ongoing projects found</p>
              <p className="empty-state__sub">Try adjusting your search or date filter.</p>
            </div>
          ) : (
            <>
              <div className="df-grid animate-fade-up delay-2">
                {pgOngoing.paginated.map((order, i) => renderOrderCard(order, i))}
              </div>
              <Pagination page={pgOngoing.page} totalPages={pgOngoing.totalPages} setPage={pgOngoing.setPage} total={pgOngoing.total} pageSize={10} />
            </>
          )}
        </>
      )}

      {/* Completed */}
      {tab === 'completed' && (
        <>
          {filteredCompleted.length === 0 ? (
            <div className="empty-state animate-fade-up">
              <div className="empty-state__icon">◈</div>
              <p className="empty-state__text">No completed projects found</p>
              <p className="empty-state__sub">Try adjusting your search or date filter.</p>
            </div>
          ) : (
            <>
              <div className="df-grid animate-fade-up delay-2">
                {pgCompleted.paginated.map((order, i) => renderOrderCard(order, i))}
              </div>
              <Pagination page={pgCompleted.page} totalPages={pgCompleted.totalPages} setPage={pgCompleted.setPage} total={pgCompleted.total} pageSize={10} />
            </>
          )}
        </>
      )}

      {/* Edit File Modal */}
      <Modal open={!!editModal} onClose={() => setEditModal(null)} title="Edit File" size="sm">
        {editModal && (
          <>
            <div className="form-group">
              <label className="form-label">File Name *</label>
              <input className={`form-input ${editErrors.name ? 'input-error' : ''}`} value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. home-kit-front-v2.png" />
              {editErrors.name && <p className="field-error">{editErrors.name}</p>}
            </div>
            <div className="form-group">
              <label className="form-label">File URL / Link <span style={{ color: 'var(--gray-mid)', fontWeight: 400 }}>(optional)</span></label>
              <input className={`form-input ${editErrors.url ? 'input-error' : ''}`} value={editForm.url} onChange={e => setEditForm(p => ({ ...p, url: e.target.value }))} placeholder="https://drive.google.com/…" />
              {editErrors.url && <p className="field-error">{editErrors.url}</p>}
            </div>
            <div className="form-group">
              <label className="form-label">Notes</label>
              <input className="form-input" value={editForm.notes} onChange={e => setEditForm(p => ({ ...p, notes: e.target.value }))} placeholder="e.g. Final approved version" />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setEditModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveEdit}>Save Changes</button>
            </div>
          </>
        )}
      </Modal>

      {/* Image Preview Modal */}
      <Modal open={!!previewFile} onClose={() => setPreviewFile(null)} title={previewFile?.name || 'File Preview'} size="lg">
        {previewFile && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 15 }}>
            <div style={{ width: '100%', background: 'var(--gray-surface)', borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'center', alignItems: 'center', overflow: 'hidden', minHeight: '300px' }}>
              <img
                src={previewFile.url}
                alt={previewFile.name}
                style={{
                  maxWidth: '100%',
                  maxHeight: '75vh',
                  width: 'auto',
                  height: 'auto',
                  objectFit: 'contain',
                  display: 'block'
                }}
              />
            </div>

            {previewFile.url.startsWith('data:') && (
              <p style={{ fontSize: 11, color: 'var(--gray-mid)', textAlign: 'center' }}>
                Note: This is an embedded image from the Job Order System.
              </p>
            )}
            <div className="modal-actions" style={{ width: '100%' }}>
              <button className="btn btn-secondary" style={{ width: '100%' }} onClick={() => setPreviewFile(null)}>Close Preview</button>
            </div>
          </div>
        )}
      </Modal>

      {/* Job Order Sheet Modal */}
      <Modal open={!!sheetModal} onClose={() => setSheetModal(null)} title="Job Order Sheet" size="lg">
        {sheetModal && (() => {
          const o = sheetModal
          const teamName = o.teamName || o.customer || 'Team Name'
          const rows = o.rows || []
          const largeSizes = new Set(['XXL', '3XL', '4XL', '5XL', 'XXXL', 'XXXXL'])
          const deadline = o.deadline ? formatDate(o.deadline) : 'TBD'
          const finalDesignUrl = o.designFileUrl || o.finalDesignUrl || ''
          return (
            <div style={{ fontFamily: "'Segoe UI', Tahoma, sans-serif" }}>
              {/* Header */}
              <div style={{ textAlign: 'center', marginBottom: 20, paddingBottom: 16, borderBottom: '3px solid #111' }}>
                <h2 style={{ fontSize: 28, fontWeight: 900, color: '#CC1111', letterSpacing: '2px', textTransform: 'uppercase', margin: 0 }}>{teamName}</h2>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  {o.productType && <span style={{ fontSize: 12, fontWeight: 700, color: '#444', letterSpacing: '1px', textTransform: 'uppercase', background: '#f4f4f4', padding: '3px 10px', border: '1px solid #ddd', borderRadius: 4 }}>{o.productType}</span>}
                  {o.fabricName && <><span style={{ color: '#ccc', fontSize: 14 }}>·</span><span style={{ fontSize: 12, fontWeight: 700, color: '#1e40af', letterSpacing: '1px', textTransform: 'uppercase', background: '#eff6ff', padding: '3px 10px', border: '1px solid #bfdbfe', borderRadius: 4 }}>🧵 {o.fabricName}</span></>}
                </div>
                <p style={{ marginTop: 6, fontSize: 11, color: '#aaa' }}>
                  {o.customer !== teamName && <span>{o.customer} · </span>}
                  <span style={{ fontFamily: 'monospace' }}>{o.orderId}</span>
                  <span style={{ marginLeft: 12 }}>Deadline: <strong style={{ color: '#333' }}>{deadline}</strong></span>
                </p>
              </div>

              {/* Player table */}
              <div style={{ overflowX: 'auto', borderRadius: 'var(--radius-lg)', border: '1px solid var(--gray-border)', marginBottom: 16 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#f4f4f4' }}>
                      {['Name', '#', 'Size', 'Add-On', 'Type'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#333', borderBottom: '2px solid #ddd', textAlign: h === 'Name' ? 'left' : 'center' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length > 0 ? rows.map((row, i) => {
                      const size = row.upperSize || '—'
                      const isLarge = largeSizes.has(size.toUpperCase())
                      return (
                        <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                          <td style={{ padding: '8px 12px', fontWeight: 600, color: '#222', borderBottom: '1px solid #eee' }}>{row.name || '—'}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'center', color: '#444', borderBottom: '1px solid #eee' }}>{row.no || '—'}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'center', borderBottom: '1px solid #eee' }}>
                            <span style={{ display: 'inline-block', ...(isLarge ? { background: '#FF69B4', color: '#fff', fontWeight: 700, padding: '2px 10px', borderRadius: 4 } : { color: '#333', fontWeight: 500 }), fontSize: 12 }}>{size}</span>
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#1d4ed8', textTransform: 'uppercase', borderBottom: '1px solid #eee' }}>{row.addOn || '—'}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'center', fontSize: 12, color: '#555', textTransform: 'uppercase', borderBottom: '1px solid #eee' }}>{row.upperType || '—'}</td>
                        </tr>
                      )
                    }) : (
                      <tr>
                        <td colSpan={5} style={{ padding: 20, textAlign: 'center', color: '#bbb', fontSize: 12, borderBottom: '1px solid #eee' }}>No lineup details provided</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Stats row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
                <span style={{ fontSize: 12, color: '#888' }}>{rows.length} player{rows.length !== 1 ? 's' : ''} total</span>
                {rows.some(r => largeSizes.has((r.upperSize || '').toUpperCase())) && (
                  <span style={{ fontSize: 11, color: '#e91e9c', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#FF69B4' }}></span>
                    Oversized sizes present
                  </span>
                )}
                <span style={{ marginLeft: 'auto', fontSize: 12, color: '#aaa' }}>Total: <strong style={{ color: '#111' }}>{formatCurrency(o.totalAmount)}</strong></span>
              </div>

              {/* Notes */}
              {o.notes && (
                <div style={{ background: '#f9f9f9', border: '1px solid #eee', borderRadius: 'var(--radius-md)', padding: '12px 16px', marginBottom: 16 }}>
                  <p style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Notes</p>
                  <p style={{ fontSize: 12, color: '#444', fontStyle: 'italic', lineHeight: 1.6 }}>{o.notes}</p>
                </div>
              )}

              {/* Final Design */}
              {finalDesignUrl && (
                <div style={{ marginBottom: 16, textAlign: 'center' }}>
                  <p style={{ fontSize: 10, fontWeight: 800, color: '#222', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 10, borderBottom: '2px solid #f0f0f0', paddingBottom: 4, display: 'inline-block' }}>Final Approved Design</p>
                  <div style={{ background: 'var(--gray-surface)', border: '1px solid var(--gray-border)', borderRadius: 'var(--radius-lg)', padding: 12, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                    <img src={finalDesignUrl} alt="Final Design" style={{ maxWidth: '100%', maxHeight: '400px', objectFit: 'contain' }} />
                  </div>
                </div>
              )}

              {/* Sign-off preview */}
              <div style={{ borderTop: '1px solid var(--gray-border)', paddingTop: 16, display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, marginBottom: 16 }}>
                {['Graphic Artist', 'Printer', 'Fabric Cutter', 'Heat Press', 'Sewer'].map(role => (
                  <div key={role} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#222', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{role}:</span>
                    <span style={{ fontSize: 10, color: '#888', marginTop: 20, borderTop: '0.5px solid #bbb', paddingTop: 3 }}>Checked by:</span>
                  </div>
                ))}
              </div>

              {/* Actions */}
              <div className="modal-actions">
                <button className="btn btn-secondary" onClick={() => setSheetModal(null)}>Close</button>
                <button className="btn btn-primary" onClick={() => printJobOrderSheet(o)}>🖨️ Print PDF</button>
              </div>
            </div>
          )
        })()}
      </Modal>
    </div>
  )
}
