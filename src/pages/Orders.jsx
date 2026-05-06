import { usePermission } from '../hooks/usePermission'
import NoPermissionModal from '../components/ui/NoPermissionModal'
import { useState, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import PageHeader from '../components/ui/PageHeader'
import DataTable from '../components/ui/DataTable'
import Badge from '../components/ui/Badge'
import Modal from '../components/ui/Modal'
import Pagination from '../components/ui/Pagination'
import { usePagination } from '../hooks/usePagination'
import { formatCurrency, formatDate, generateId, getStatusColor, getDaysUntil, derivePaymentStatus, nowISO, PERIOD_PRESETS, getPresetRange, inRange } from '../utils/helpers'
import { PRODUCTION_STAGES, SIZE_KEYS, EMPTY_SIZES } from '../utils/constants'
import { post, put, patch } from '../utils/api'
import './PageCommon.css'
import './OrderHistory.css'


const ConfirmModal = ({ open, title, message, onConfirm, onCancel, confirmLabel = 'Confirm', danger = false }) => (
  <Modal open={open} onClose={onCancel} title={title} size="sm">
    <p style={{ color: 'var(--gray-dark)', lineHeight: 1.6, marginBottom: 4 }}>{message}</p>
    <div className="modal-actions">
      <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
      <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>{confirmLabel}</button>
    </div>
  </Modal>
)

export default function Orders() {
  const { orders, addOrder, updateOrder, archiveOrder, completeOrder } = useApp()
  const { guard, denied, clearDenied, isAdmin } = usePermission()
  const [tab, setTab] = useState('pending')
  const [search, setSearch] = useState('')
  const [stFilter, setStFilter] = useState('All')
  const [modal, setModal] = useState(null)
  const [selected, setSelected] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const [completeAmt, setCompleteAmt] = useState('')
  const [archiveConfirm, setArchiveConfirm] = useState(null)
  const [viewModal, setViewModal] = useState(null)
  const [errors, setErrors] = useState({})

  // ── Date Filtering (for Completed Tab) ──
  const [period, setPeriod] = useState('today')
  const [customFrom, setCustomFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10) })
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().slice(0, 10))

  const range = useMemo(() => {
    if (period === 'custom') return { from: new Date(customFrom + 'T00:00:00'), to: new Date(customTo + 'T23:59:59') }
    return getPresetRange(period) || getPresetRange('today')
  }, [period, customFrom, customTo])

  const rangeLabel = useMemo(() => {
    const fmt = (d) => d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
    return `${fmt(range.from)} – ${fmt(range.to)}`
  }, [range])

  const pending = orders.filter(o => !o.isCompleted && !o.isArchived)
  const completed = orders.filter(o => o.isCompleted && !o.isArchived)

  const filterList = (list, isCompleted = false) => list.filter(o => {
    const term = search.toLowerCase()
    const ms = o.customer.toLowerCase().includes(term) ||
      (o.teamName || '').toLowerCase().includes(term) ||
      (o.orderId || '').toLowerCase().includes(term)
    
    // Status filter only for pending
    if (!isCompleted) {
      const mf = stFilter === 'All' || o.status === stFilter
      return ms && mf
    }

    // Date filter only for completed
    const matchDate = inRange(o.completedAt || o.updatedAt, range.from, range.to)
    return ms && matchDate
  })

  const pgPending = usePagination(filterList(pending, false), 10)
  const pgCompleted = usePagination(filterList(completed, true), 10)

  const totalDue = (o) => Math.max(0, (o.totalAmount || 0) - (o.paidAmount || 0))


  /* ── Update helpers ── */
  const ef = (k, v) => setEditForm(p => ({ ...p, [k]: v }))

  const validateUpdate = () => {
    const e = {}
    if (!editForm.customer?.trim()) e.customer = 'Customer name is required.'
    if (!editForm.deadline) e.deadline = 'Deadline is required.'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleUpdate = async () => {
    if (!validateUpdate()) return
    const paid = Number(editForm.paidAmount) || 0
    const total = Number(editForm.totalAmount) || selected.totalAmount
    const res = await put(`/orders/${selected.id}`, { ...editForm, paidAmount: paid, totalAmount: total })
    if (res.ok) {
      updateOrder(selected.id, { ...editForm, payment: derivePaymentStatus(paid, total) })
      setModal(null)
    } else {
      alert(res.error || 'Failed to update order.')
    }
  }

  /* ── Re-order ── */
  const handleReorder = async () => {
    if (!editForm.deadline) { setErrors({ deadline: 'Deadline is required.' }); return }
    const payload = {
      ...editForm,
      orderId: generateId('ORD'),
      status: 'Order Received',
      paidAmount: Number(editForm.paidAmount) || 0,
      totalAmount: Number(editForm.totalAmount) || 0,
    }
    const res = await post('/orders', payload)
    if (res.ok) {
      addOrder({ ...res.order, id: res.order._id })
      setModal(null)
    } else {
      alert(res.error || 'Failed to place re-order.')
    }
  }

  /* ── Archive confirm ── */
  const doArchive = async () => {
    if (archiveConfirm) {
      const res = await patch(`/orders/${archiveConfirm.id}/archive`)
      if (res.ok) {
        archiveOrder(archiveConfirm.id)
        setArchiveConfirm(null)
      } else {
        alert(res.error || 'Failed to archive order.')
      }
    }
  }


  /* ── Table columns ── */
  const pendingCols = [
    { key: 'orderId', label: 'Order ID', render: v => <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 13 }}>{v}</span> },
    { key: 'customer', label: 'Customer', render: (v, row) => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <p style={{ fontWeight: 700, color: 'var(--black)', fontSize: 13, lineHeight: 1.2 }}>{v}</p>
        <p style={{ fontSize: 11, color: '#444', fontWeight: 600 }}>{row.teamName || '—'}</p>
        <p style={{ fontSize: 10, color: 'var(--gray-mid)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.02em' }}>{row.productType || row.design || '—'}</p>
      </div>
    )},
    { key: 'rows', label: 'Items', render: (v, row) => <span style={{ fontSize: 12 }}>{(v || row.items || []).length} row{(v || row.items || []).length !== 1 ? 's' : ''}</span> },
    { key: 'deadline', label: 'Deadline', render: (v, row) => { const d = getDaysUntil(v); return <span style={{ color: d <= 3 ? '#c62828' : 'inherit', fontWeight: d <= 3 ? 600 : 400 }}>{formatDate(v)}{d <= 0 ? ' ⚠' : d <= 3 ? ` (${d}d)` : ''}</span> } },
    { key: 'status', label: 'Status', render: v => <Badge status={getStatusColor(v)}>{v}</Badge> },
    { key: 'payment', label: 'Payment', render: v => <Badge status={getStatusColor(v)}>{v}</Badge> },
    { key: 'totalAmount', label: 'Amount', render: (v, row) => <div><p>{formatCurrency(v || row.totalPrice)}</p><p style={{ fontSize: 12, color: 'var(--gray-mid)' }}>Balance: {formatCurrency(Math.max(0, (v || row.totalPrice || 0) - (row.paidAmount || 0)))}</p></div> },
    {
      key: 'id', label: '', render: (_, row) => (
        <div className="td-actions">
          <button className="td-btn" style={{ color: '#1565c0', fontWeight: 600 }} onClick={() => setViewModal(row)}>View Details</button>
          <button className="td-btn" onClick={() => { setSelected(row); setEditForm({ ...row }); setErrors({}); setModal('update') }}>Update</button>
          <button className="td-btn td-btn--del" onClick={() => guard('archive', () => setArchiveConfirm(row))}>Archive</button>
        </div>
      )
    },
  ]

  const completedCols = [
    { key: 'orderId', label: 'Order ID', render: v => <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 13 }}>{v}</span> },
    { key: 'customer', label: 'Customer', render: (v, row) => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <p style={{ fontWeight: 700, color: 'var(--black)', fontSize: 13, lineHeight: 1.2 }}>{v}</p>
        <p style={{ fontSize: 11, color: '#444', fontWeight: 600 }}>{row.teamName || '—'}</p>
        <p style={{ fontSize: 10, color: 'var(--gray-mid)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.02em' }}>{row.productType || row.design || '—'}</p>
      </div>
    )},
    { key: 'completedAt', label: 'Completed', render: v => formatDate(v) },
    { key: 'payment', label: 'Payment', render: (v, row) => <Badge status="status-green">Paid</Badge> },
    { key: 'totalAmount', label: 'Amount', render: (v, row) => <div><p>{formatCurrency(v)}</p><p style={{ fontSize: 12, color: '#2e7d32' }}>{formatCurrency(v)} received</p></div> },
    {
      key: 'id', label: '', render: (_, row) => (
        <div className="td-actions">
          <button className="td-btn" style={{ color: '#1565c0', fontWeight: 600 }} onClick={() => setViewModal(row)}>View Details</button>
          <button className="td-btn td-btn--del" onClick={() => guard('archive', () => setArchiveConfirm(row))}>Archive</button>
        </div>
      )
    },
  ]

  return (
    <div>
      <PageHeader title="Job Orders" subtitle="Manage all active and completed job orders" />

      <div className="oh-tabs animate-fade-up">
        {[{ key: 'pending', label: `Active Orders (${pending.length})` }, { key: 'completed', label: `Completed (${completed.length})` }].map(t => (
          <button key={t.key} className={`archive-tab ${tab === t.key ? 'archive-tab--active' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      <div className="page-toolbar animate-fade-up delay-1" style={tab === 'completed' ? { flexDirection: 'column', alignItems: 'flex-start', gap: 10 } : {}}>
        <input className="toolbar-search" placeholder="Search customer or team name" value={search} onChange={e => { setSearch(e.target.value); pgPending.setPage(1); pgCompleted.setPage(1); }} />
        
        {tab === 'pending' && (
          <div className="toolbar-filters">
            {['All', ...PRODUCTION_STAGES].map(s => (
              <button key={s} className={`filter-chip ${stFilter === s ? 'filter-chip--active' : ''}`} onClick={() => { setStFilter(s); pgPending.setPage(1); }}>{s}</button>
            ))}
          </div>
        )}

        {tab === 'completed' && (
          <div className="period-bar" style={{ marginBottom: 0, padding: 0, border: 'none', background: 'transparent' }}>
            <span style={{ fontSize: 12, color: 'var(--gray-mid)', fontWeight: 500, marginRight: 2 }}>Date Completed:</span>
            <div className="period-chips">
              {PERIOD_PRESETS.map(p => (
                <button
                  key={p.key}
                  className={`filter-chip ${period === p.key ? 'filter-chip--active' : ''}`}
                  onClick={() => { setPeriod(p.key); pgCompleted.setPage(1); }}
                >{p.label}</button>
              ))}
            </div>
            {period === 'custom' && (
              <div className="period-custom-range">
                <input type="date" className="form-input" style={{ width: 140, padding: '6px 10px', fontSize: 12 }} value={customFrom} onChange={e => { setCustomFrom(e.target.value); pgCompleted.setPage(1); }} />
                <span style={{ color: 'var(--gray-mid)', fontSize: 12 }}>to</span>
                <input type="date" className="form-input" style={{ width: 140, padding: '6px 10px', fontSize: 12 }} value={customTo} onChange={e => { setCustomTo(e.target.value); pgCompleted.setPage(1); }} />
              </div>
            )}
            <span className="period-label">📅 {rangeLabel}</span>
          </div>
        )}
      </div>

      <div className="animate-fade-up delay-2">
        {tab === 'pending' && <><DataTable columns={pendingCols} data={pgPending.paginated} emptyText="No active orders." /><Pagination page={pgPending.page} totalPages={pgPending.totalPages} setPage={pgPending.setPage} total={pgPending.total} pageSize={10} /></>}
        {tab === 'completed' && <><DataTable columns={completedCols} data={pgCompleted.paginated} emptyText="No completed orders." /><Pagination page={pgCompleted.page} totalPages={pgCompleted.totalPages} setPage={pgCompleted.setPage} total={pgCompleted.total} pageSize={10} /></>}
      </div>


      {/* ── Update Modal ── */}
      <Modal open={modal === 'update'} onClose={() => setModal(null)} title={`Update Order — ${selected?.orderId}`} size="md">
        {editForm && selected && <>

          {/* ── Admin-only fields notice for staff ── */}
          {!isAdmin && (
            <div style={{ background: '#fff3e0', border: '1px solid #ffcc02', borderRadius: 'var(--radius-md)', padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#e65100', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 16, flexShrink: 0 }}>ℹ️</span>
              <span>Some fields below are <strong>Admin-only</strong> and are locked. You can update the <strong>Additional Payment</strong> and <strong>Notes</strong> fields only. Contact your Administrator to change customer info, deadline, status, or design details.</span>
            </div>
          )}

          {/* Customer + Team */}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Customer Name {!isAdmin && <span style={{ fontSize: 10, background: '#fdecea', color: '#c62828', borderRadius: 4, padding: '1px 6px', marginLeft: 6, fontWeight: 600 }}>Admin Only</span>}</label>
              <input
                className={`form-input ${errors.customer ? 'input-error' : ''}`}
                value={editForm.customer}
                onChange={e => ef('customer', e.target.value)}
                disabled={!isAdmin}
                style={!isAdmin ? { background: 'var(--gray-surface)', color: 'var(--gray-mid)', cursor: 'not-allowed' } : {}}
              />
              {errors.customer && <p className="field-error">{errors.customer}</p>}
            </div>
            <div className="form-group">
              <label className="form-label">Team Name {!isAdmin && <span style={{ fontSize: 10, background: '#fdecea', color: '#c62828', borderRadius: 4, padding: '1px 6px', marginLeft: 6, fontWeight: 600 }}>Admin Only</span>}</label>
              <input
                className="form-input"
                value={editForm.teamName || ''}
                onChange={e => ef('teamName', e.target.value)}
                disabled={!isAdmin}
                style={!isAdmin ? { background: 'var(--gray-surface)', color: 'var(--gray-mid)', cursor: 'not-allowed' } : {}}
              />
            </div>
          </div>

          {/* Contact + Deadline */}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Contact {!isAdmin && <span style={{ fontSize: 10, background: '#fdecea', color: '#c62828', borderRadius: 4, padding: '1px 6px', marginLeft: 6, fontWeight: 600 }}>Admin Only</span>}</label>
              <input
                className="form-input"
                value={editForm.contact || ''}
                onChange={e => ef('contact', e.target.value)}
                disabled={!isAdmin}
                style={!isAdmin ? { background: 'var(--gray-surface)', color: 'var(--gray-mid)', cursor: 'not-allowed' } : {}}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Deadline {!isAdmin && <span style={{ fontSize: 10, background: '#fdecea', color: '#c62828', borderRadius: 4, padding: '1px 6px', marginLeft: 6, fontWeight: 600 }}>Admin Only</span>}</label>
              <input
                className={`form-input ${errors.deadline ? 'input-error' : ''}`}
                type="date"
                value={editForm.deadline}
                onChange={e => ef('deadline', e.target.value)}
                disabled={!isAdmin}
                style={!isAdmin ? { background: 'var(--gray-surface)', color: 'var(--gray-mid)', cursor: 'not-allowed' } : {}}
              />
              {errors.deadline && <p className="field-error">{errors.deadline}</p>}
            </div>
          </div>
            <div className="form-group">
              <label className="form-label">Status {!isAdmin && <span style={{ fontSize: 10, background: '#fdecea', color: '#c62828', borderRadius: 4, padding: '1px 6px', marginLeft: 6, fontWeight: 600 }}>Admin Only</span>}</label>
              {isAdmin ? (
                <select className="form-select" value={editForm.status} onChange={e => {
                  ef('status', e.target.value)
                  if (e.target.value === '__complete__') {
                    setCompleteAmt(Math.max(0, (selected.totalAmount || 0) - (selected.paidAmount || 0)))
                  }
                }}>
                  {PRODUCTION_STAGES.map(s => <option key={s}>{s}</option>)}
                </select>

              ) : (
                <input className="form-input" value={editForm.status || ''} disabled style={{ background: 'var(--gray-surface)', color: 'var(--gray-mid)', cursor: 'not-allowed' }} />
              )}
            </div>
          </div>



          {/* Design — Admin only */}
          <div className="form-group">
            <label className="form-label">Design Description {!isAdmin && <span style={{ fontSize: 10, background: '#fdecea', color: '#c62828', borderRadius: 4, padding: '1px 6px', marginLeft: 6, fontWeight: 600 }}>Admin Only</span>}</label>
            <input
              className="form-input"
              value={editForm.design || ''}
              onChange={e => ef('design', e.target.value)}
              disabled={!isAdmin}
              style={!isAdmin ? { background: 'var(--gray-surface)', color: 'var(--gray-mid)', cursor: 'not-allowed' } : {}}
            />
          </div>

          {/* Additional Payment — accessible to staff */}
          <div className="form-group">
            <label className="form-label">Additional Payment (₱)</label>
            <input
              className="form-input"
              type="number"
              placeholder="0"
              onChange={e => ef('paidAmount', (selected.paidAmount || 0) + (Number(e.target.value) || 0))}
            />
            <p className="size-subtotal" style={{ marginTop: 4 }}>Total paid: {formatCurrency(editForm.paidAmount || 0)} / {formatCurrency(editForm.totalAmount || 0)}</p>
          </div>

          {/* Notes — accessible to staff */}
          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea className="form-textarea" value={editForm.notes || ''} onChange={e => ef('notes', e.target.value)} />
          </div>

          <div className="modal-actions">
            <button className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button>
            <button
              className="btn btn-primary"
              onClick={handleUpdate}
            >
              Save Changes
            </button>

          </div>
        </>}
      </Modal>



      {/* ── Re-order Modal ── */}
      <Modal open={modal === 'reorder'} onClose={() => setModal(null)} title={`Re-order — ${selected?.customer}`} size="sm">
        {editForm && <>
          <div style={{ background: '#e3f2fd', borderRadius: 'var(--radius-md)', padding: '10px 14px', marginBottom: 14, fontSize: 13, color: '#1565c0' }}>
            Creating a new order based on <strong>{selected?.id}</strong>.
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Customer *</label>
              <input className="form-input" value={editForm.customer} onChange={e => ef('customer', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Team Name</label>
              <input className="form-input" value={editForm.teamName || ''} onChange={e => ef('teamName', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Deadline *</label>
              <input className={`form-input ${errors.deadline ? 'input-error' : ''}`} type="date" value={editForm.deadline} onChange={e => ef('deadline', e.target.value)} />
              {errors.deadline && <p className="field-error">{errors.deadline}</p>}
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Grand Total (₱)</label>
              <input className="form-input" type="number" value={editForm.totalAmount} onChange={e => ef('totalAmount', Number(e.target.value) || 0)} />
            </div>
            <div className="form-group">
              <label className="form-label">Down Payment (₱)</label>
              <input className="form-input" type="number" value={editForm.paidAmount} onChange={e => ef('paidAmount', Number(e.target.value) || 0)} />
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleReorder}>Place Re-order</button>
          </div>
        </>}
      </Modal>

      {/* ── View Details Modal ── */}
      <Modal open={!!viewModal} onClose={() => setViewModal(null)} title="" size="lg">
        {viewModal && (
          <>
            {/* ── Enhanced header ── */}
            <div style={{ background: '#0d0d0d', borderRadius: 'var(--radius-lg)', padding: '18px 22px', marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>Job Order</p>
                <p style={{ fontSize: 22, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em', marginBottom: 2 }}>{viewModal.orderId}</p>
                <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)' }}>{typeof viewModal.customer === 'object' ? '—' : viewModal.customer}</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Total Amount</p>
                <p style={{ fontSize: 24, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em' }}>
                  {(() => {
                    const computed = (viewModal.rows || []).reduce((s, r) => {
                      const up = viewModal.upperPrice || 450, lp = viewModal.lowerPrice || 450
                      return s + (r.upperType && r.upperSize ? up : 0) + (r.lowerType && r.lowerSize ? lp : 0)
                    }, 0)
                    return formatCurrency(viewModal.totalAmount || computed)
                  })()}
                </p>
                <span style={{ display: 'inline-block', marginTop: 4, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: '#2e7d32', color: '#fff' }}>Paid</span>
              </div>
            </div>

            {/* ── Info grid ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 18 }}>
              {[
                ['Contact', viewModal.contact || '—'],
                ['Design', ['Order Received', 'Designing'].includes(viewModal.status) ? '' : (viewModal.design || '—')],
                ['Status', viewModal.status || '—'],
                ['Amount Paid', formatCurrency(viewModal.paidAmount || 0)],
                ['Balance', formatCurrency(Math.max(0, (viewModal.totalAmount || viewModal.totalPrice || 0) - (viewModal.paidAmount || 0)))],
                ['Deadline', formatDate(viewModal.deadline)],
                ['Created', formatDate(viewModal.createdAt)],
                ['Completed', viewModal.completedAt ? formatDate(viewModal.completedAt) : '—'],
              ].map(([label, value]) => (
                <div key={label} style={{ background: 'var(--gray-surface)', borderRadius: 'var(--radius-md)', padding: '10px 14px', border: '1px solid var(--gray-border)' }}>
                  <p style={{ fontSize: 10, color: 'var(--gray-mid)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 3 }}>{label}</p>
                  <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--black)' }}>
                    {typeof value === 'object' ? '—' : (value || '—')}
                  </p>
                </div>
              ))}
            </div>

            {/* ── Summary of Items and Sizes table ── */}
            {((viewModal.rows || []).length > 0 || (viewModal.items || []).length > 0) && (
              <div style={{ marginBottom: 18 }}>
                <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--black)', marginBottom: 10 }}>Summary of Items and Sizes</p>
                <div style={{ overflowX: 'auto', borderRadius: 'var(--radius-lg)', border: '1px solid var(--gray-border)' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: 'var(--gray-surface)' }}>
                        {['No.', 'Name', 'Size', 'Type', 'Add-On', 'Amount'].map(h => (
                          <th key={h} style={{ padding: '9px 14px', textAlign: h === 'Amount' ? 'right' : 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--gray-mid)', borderBottom: '1px solid var(--gray-border)', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(viewModal.rows || []).map((row, i) => {
                        if (!row) return null;
                        const count = viewModal.rows?.length || 1;
                        const totalAddons = (viewModal.rows || []).reduce((s, r) => s + (r.addOnPrice || 0), 0);
                        const derivedBase = (viewModal.totalAmount - totalAddons) / count;
                        const up = viewModal.upperPrice || (derivedBase > 0 ? derivedBase : 650);

                        const addOnP = row.addOnPrice || 0
                        const amt = (up > 0 ? up : 0) + addOnP
                        return (
                          <tr key={i} style={{ borderBottom: '1px solid var(--gray-border)', background: i % 2 === 1 ? '#fafafa' : '#fff' }}>
                            <td style={{ padding: '10px 14px', fontWeight: 600 }}>{row.no || '--'}</td>
                            <td style={{ padding: '10px 14px', fontWeight: 600 }}>{typeof row.name === 'object' ? (row.name.name || '—') : (row.name || '--')}</td>
                            <td style={{ padding: '10px 14px' }}>
                              {row.upperSize && row.lowerSize && row.upperSize === row.lowerSize 
                                ? row.upperSize 
                                : `${row.upperSize || '--'}${row.lowerSize ? ` / ${row.lowerSize}` : ''}`}
                            </td>
                            <td style={{ padding: '10px 14px', color: 'var(--gray-mid)' }}>
                              {(typeof row.upperType === 'object' ? row.upperType.name : row.upperType) || 
                               (typeof viewModal.productType === 'object' ? viewModal.productType.name : viewModal.productType) || '--'}
                              {row.lowerType && row.lowerType !== row.upperType && ` / ${typeof row.lowerType === 'object' ? row.lowerType.name : row.lowerType}`}
                              <span style={{ fontSize: 10, marginLeft: 5, color: 'var(--gray-light)' }}>({formatCurrency(up || 650)})</span>
                            </td>
                            <td style={{ padding: '10px 14px', color: 'var(--gray-mid)' }}>{typeof row.addOn === 'object' ? (row.addOn.name || '—') : (row.addOn || '--')}</td>
                            <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: 'var(--black)', whiteSpace: 'nowrap' }}>
                              {addOnP > 0 ? (
                                <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                                  <span>{up || 650}</span>
                                  <span style={{ fontSize: 11, color: 'var(--gray-mid)', fontWeight: 400 }}>+ {addOnP}</span>
                                </div>
                              ) : (
                                <span>{up || 650}</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                      {/* Fallback for legacy item-format orders */}
                      {(viewModal.rows || []).length === 0 && (viewModal.items || []).map((item, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--gray-border)', background: i % 2 === 1 ? '#fafafa' : '#fff' }}>
                          <td style={{ padding: '10px 14px', fontWeight: 600 }}>{item.no || '--'}</td>
                          <td style={{ padding: '10px 14px', fontWeight: 600 }}>{item.name || '--'}</td>
                          <td style={{ padding: '10px 14px' }} colSpan={2}>
                            {Object.entries(item.sizes || {}).filter(([, v]) => v > 0).map(([sz, qty]) => `${sz}×${qty}`).join(', ') || '--'}
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'right' }}>--</td>
                        </tr>
                      ))}
                      {/* Total row */}
                      <tr style={{ background: '#0d0d0d' }}>
                        <td colSpan={5} style={{ padding: '10px 14px', fontWeight: 700, fontSize: 13, color: 'rgba(255,255,255,0.7)', textAlign: 'right', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Total Amount</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 800, fontSize: 15, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
                          {(() => {
                            const computed = (viewModal.rows || []).reduce((s, r) => {
                              if (!r) return s;
                              const up = viewModal.upperPrice || 450, lp = viewModal.lowerPrice || 450
                              return s + (r.upperType && r.upperSize ? up : 0) + (r.lowerType && r.lowerSize ? lp : 0)
                            }, 0)
                            return formatCurrency(viewModal.totalAmount || computed)
                          })()}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                {!viewModal.externalRef && (
                  <p style={{ fontSize: 11, color: 'var(--gray-mid)', marginTop: 6 }}>
                    Upper: {formatCurrency(viewModal.upperPrice || 450)}/pc · Lower: {formatCurrency(viewModal.lowerPrice || 450)}/pc
                  </p>
                )}
              </div>
            )}

            {/* ── Notes ── */}
            {viewModal.notes && (
              <div style={{ background: '#fffde7', border: '1px solid #ffe082', borderRadius: 'var(--radius-md)', padding: '12px 16px', marginBottom: 16, display: 'flex', gap: 10 }}>
                <span style={{ fontSize: 16 }}>📝</span>
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: '#827717', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Notes</p>
                  <p style={{ fontSize: 13, color: '#555', lineHeight: 1.6 }}>{viewModal.notes}</p>
                </div>
              </div>
            )}

            {/* ── Design files ── */}
            {(viewModal.designFiles || []).length > 0 && (
              <div style={{ marginBottom: 4 }}>
                <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--black)', marginBottom: 8 }}>Design Files</p>
                {(viewModal.designFiles || []).map(f => (
                  <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'var(--gray-surface)', borderRadius: 'var(--radius-md)', marginBottom: 6, border: '1px solid var(--gray-border)' }}>
                    <div style={{ width: 32, height: 32, background: 'var(--black)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14, flexShrink: 0 }}>◈</div>
                    <div style={{ flex: 1 }}>
                      {f.url
                        ? <a href={f.url} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 600, color: '#1565c0', textDecoration: 'underline' }}>{f.name}</a>
                        : <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--black)' }}>{f.name}</span>
                      }
                      {f.notes && <p style={{ fontSize: 11, color: 'var(--gray-mid)', marginTop: 1 }}>{f.notes}</p>}
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--gray-light)' }}>{formatDate(f.uploadedAt)}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setViewModal(null)}>Close</button>
            </div>
          </>
        )}
      </Modal>

      <NoPermissionModal info={denied} onClose={clearDenied} />

      <ConfirmModal
        open={!!archiveConfirm}
        title="Archive Order"
        message={`Archive order "${archiveConfirm?.id}" for ${archiveConfirm?.customer}? It will be moved to the Archive and can be restored.`}
        onConfirm={doArchive}
        onCancel={() => setArchiveConfirm(null)}
        confirmLabel="Archive"
      />
    </div>
  )
}
