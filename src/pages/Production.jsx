import { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import PageHeader from '../components/ui/PageHeader'
import Badge from '../components/ui/Badge'
import Modal from '../components/ui/Modal'
import { formatDate, getDaysUntil, derivePaymentStatus, formatCurrency } from '../utils/helpers'
import { patch } from '../utils/api'
import { PRODUCTION_STAGES } from '../utils/constants'
import './PageCommon.css'
import './Production.css'

const EMPTY_MAT_ROW = { materialId:'', materialName:'', qty:'' }

export default function Production() {
  const { orders, materials, updateOrder, advanceOrderStage, completeOrder, refreshOrders } = useApp()
  const [stageModal,   setStageModal]   = useState(null)  // { order, stageIdx, nextStage }
  const [formData,     setFormData]     = useState({})
  const [matRows,      setMatRows]      = useState([{ ...EMPTY_MAT_ROW }])
  const [errors,       setErrors]       = useState({})

  // Polling for updates from JOS
  useEffect(() => {
    const interval = setInterval(refreshOrders, 30000)
    return () => clearInterval(interval)
  }, [refreshOrders])


  const activeOrders = orders.filter(o => !o.isCompleted && !o.isArchived)
  const activeMats   = materials.filter(m => !m.isArchived)

  const addMatRow    = () => setMatRows(p => [...p, { ...EMPTY_MAT_ROW }])
  const removeMatRow = (i) => setMatRows(p => p.filter((_,idx)=>idx!==i))
  const upMatRow     = (i,k,v) => setMatRows(p => p.map((r,idx)=>idx===i?{...r,[k]:v}:r))
  const selMat       = (i, matId) => {
    const mat = activeMats.find(m => m.id === matId)
    setMatRows(p => p.map((r,idx)=>idx===i?{...r, materialId:matId, materialName:mat?.name||''}:r))
  }

  const openStage = (order, stageIdx) => {
    setStageModal({ order, stageIdx, nextStage: PRODUCTION_STAGES[stageIdx + 1] })
    setFormData({})
    setMatRows([{ ...EMPTY_MAT_ROW }])
    setErrors({})
  }
  const closeStage = () => { setStageModal(null); setErrors({}) }

  const validateAndAdvance = async () => {
    const { order, stageIdx, nextStage } = stageModal
    const e = {}

    // Stage-specific validations
    if (nextStage === 'Designing') {
      const hasExistingReceipt = order.designFiles?.some(f => f.name.toLowerCase().includes('receipt') || f.name.toLowerCase().includes('payment'));
      if (!formData.proofOfPaymentDataUrl && !hasExistingReceipt) { 
        e.proofOfPayment = 'Proof of Payment is required (or already attached in Design Files).' 
      }
      if (!formData.approved) { e.approved = 'Confirmation is required before proceeding to Designing.' }
    }
    if (nextStage === 'Printing') {
      if (!formData.fileUrl?.trim()) e.fileUrl = 'A design file URL is required before printing.'
    }
    if (nextStage === 'Heat Press') {
      const cf = Number(formData.coverageFactor)
      if (formData.coverageFactor === undefined || formData.coverageFactor === '' || isNaN(cf) || cf < 0 || cf > 100) {
        e.coverageFactor = 'Please enter a valid ink coverage percentage (0-100%).'
      }
    }

    if (nextStage === 'Ready for Pickup') {
      if (!formData.qcPassed) e.qcPassed = 'Please confirm the product has passed quality check.'
    }

    setErrors(e)
    if (Object.keys(e).length > 0) return

    // Save extra data on the order for specific stages
    const extraUpdate = {}
    if (nextStage === 'Designing' && formData.proofOfPaymentDataUrl) {
      const existingFiles = order.designFiles || []
      extraUpdate.designFiles = [
        ...existingFiles,
        {
          fileId: `df-${Date.now()}`,
          name: formData.proofOfPaymentName || 'proof-of-payment.jpg',
          url: formData.proofOfPaymentDataUrl,
          notes: 'Proof of Payment added during transition to Designing',
          uploadedAt: new Date().toISOString().slice(0, 10),
        }
      ]
      const addedDownpayment = Number(formData.downpayment) || 0
      if (addedDownpayment > 0) {
        extraUpdate.paidAmount = (order.paidAmount || 0) + addedDownpayment
      }
    }
    if (nextStage === 'Printing' && formData.fileUrl) {
      extraUpdate.designFileUrl  = formData.fileUrl
      extraUpdate.designFileName = formData.fileUrl
    }
    if (nextStage === 'Heat Press') {
      extraUpdate.coverageFactor = Number(formData.coverageFactor) / 100 // Convert 0-100 to 0.0-1.0
    }
    if (nextStage === 'Quality Check') {
      extraUpdate.threadName = formData.threadName
    }
    const consumedMaterials = matRows.filter(r => r.materialId && r.qty)
    const res = await patch(`/orders/${order.id}/advance`, { nextStage, consumedMaterials, note: formData.note || '', extraUpdate })
    if (res.ok) {
      if (Object.keys(extraUpdate).length > 0) updateOrder(order.id, extraUpdate)
      advanceOrderStage(order.id, nextStage, [], formData.note || '')
      closeStage()
    } else {
      alert(res.error || 'Failed to advance order.')
    }
  }


  const getMappedStatus = (status) => {
    if (status === 'pending' || status === 'pending-payment') return 'Order Received'
    return status
  }

  const stageIdx = (order) => PRODUCTION_STAGES.indexOf(getMappedStatus(order.status))
  const isLastStage = (order) => stageIdx(order) === PRODUCTION_STAGES.length - 1

  const renderStageModal = () => {
    if (!stageModal) return null
    const { order, stageIdx: si, nextStage } = stageModal
    const currentStatus = getMappedStatus(order.status)

    return (
      <Modal open={true} onClose={closeStage} title={`Advance to: ${nextStage}`} size="md">
        <div style={{ background:'var(--gray-surface)', borderRadius:'var(--radius-md)', padding:'12px 16px', marginBottom:16 }}>
          <p style={{ fontWeight:600, fontSize:14 }}>{order.orderId} — {order.customer}</p>
          <p style={{ fontSize:12, color:'var(--gray-mid)', marginTop:3 }}>{order.design}</p>
          <p style={{ fontSize:12, color:'var(--gray-mid)', marginTop:2 }}>Current stage: <strong>{currentStatus}</strong> → <strong style={{ color:'var(--black)' }}>{nextStage}</strong></p>
        </div>

        {/* Designing: Downpayment and Proof of Payment */}
        {nextStage === 'Designing' && (
          <>
            <div className="form-group">
              <label className="form-label">Downpayment (₱)</label>
              <input
                className="form-input"
                type="number"
                value={formData.downpayment || ''}
                onChange={e => setFormData(p => ({ ...p, downpayment: e.target.value }))}
                placeholder="0"
              />
              {formData.downpayment !== undefined && formData.downpayment !== '' && (
                <p style={{ fontSize:12, color:'var(--gray-mid)', marginTop:4 }}>
                  Total collected: {formatCurrency((order.paidAmount||0)+(Number(formData.downpayment)||0))} —{' '}
                  <strong>{derivePaymentStatus((order.paidAmount||0)+(Number(formData.downpayment)||0), order.totalAmount)}</strong>
                </p>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">Proof of Payment *</label>
              {order.designFiles?.some(f => f.name.toLowerCase().includes('receipt')) && (
                <div style={{ marginBottom: 10, padding: '8px 12px', background: '#e8f5e9', border: '1px solid #c8e6c9', borderRadius: 'var(--radius-sm)', fontSize: 12, color: '#2e7d32' }}>
                  ✓ A payment receipt is already attached to this order.
                </div>
              )}
              <input
                type="file"
                accept="image/*"
                className={`form-input ${errors.proofOfPayment?'input-error':''}`}
                onChange={e => {
                  const file = e.target.files[0]
                  if (file) {
                    const reader = new FileReader()
                    reader.onloadend = () => setFormData(p => ({ ...p, proofOfPaymentDataUrl: reader.result, proofOfPaymentName: file.name }))
                    reader.readAsDataURL(file)
                  } else {
                    setFormData(p => ({ ...p, proofOfPaymentDataUrl: null, proofOfPaymentName: null }))
                  }
                }}
              />
              {errors.proofOfPayment && <p className="field-error">{errors.proofOfPayment}</p>}
            </div>

            <div className="form-group" style={{ background:'var(--gray-surface)', borderRadius:'var(--radius-md)', padding:'12px 14px' }}>
              <label className="form-label" style={{ display:'flex', alignItems:'flex-start', gap:10, cursor:'pointer', userSelect:'none' }}>
                <input
                  type="checkbox"
                  style={{ marginTop:2, flexShrink:0 }}
                  checked={!!formData.approved}
                  onChange={e => setFormData(p => ({ ...p, approved: e.target.checked }))}
                />
                <span>I confirm that this job order is <strong>paid by downpayment</strong> and is ready to proceed to Designing.</span>
              </label>
              {errors.approved && <p className="field-error" style={{ marginTop:6 }}>{errors.approved}</p>}
            </div>
          </>
        )}

        {/* Printing: file URL */}
        {nextStage === 'Printing' && (
          <div className="form-group">
            <label className="form-label">Design File URL / Link *</label>
            <input
              className={`form-input ${errors.fileUrl?'input-error':''}`}
              value={formData.fileUrl||''}
              onChange={e => setFormData(p => ({ ...p, fileUrl: e.target.value }))}
              placeholder="https://drive.google.com/... or any file link"
            />
            {errors.fileUrl && <p className="field-error">{errors.fileUrl}</p>}
            <p style={{ fontSize:11, color:'var(--gray-mid)', marginTop:4 }}>Provide a Google Drive, Dropbox, or similar link to the final design file.</p>
          </div>
        )}

        {/* Heat Press: Ink Coverage Factor */}
        {nextStage === 'Heat Press' && (
          <div className="form-group">
            <label className="form-label">Ink Coverage Percentage (0-100%) *</label>
            <input
              className={`form-input ${errors.coverageFactor?'input-error':''}`}
              type="number"
              min="0"
              max="100"
              value={formData.coverageFactor||''}
              onChange={e => setFormData(p => ({ ...p, coverageFactor: e.target.value }))}
              placeholder="e.g. 25"
            />
            {errors.coverageFactor && <p className="field-error">{errors.coverageFactor}</p>}
            <p style={{ fontSize:11, color:'var(--gray-mid)', marginTop:4 }}>
              Enter the estimated ink coverage percentage. This will be used to deduct ink and paper from inventory.
            </p>
          </div>
        )}

        {/* Material Usage (for stages that consume materials) */}
        {['Printing', 'Heat Press', 'Sewing'].includes(nextStage) && (
          <div className="form-group" style={{ marginTop: 16 }}>
            <label className="form-label">Materials Used (Optional)</label>
            {matRows.map((row, i) => (
              <div key={i} style={{ display:'flex', gap:8, marginBottom:8 }}>
                <select 
                  className="form-input" 
                  value={row.materialId} 
                  onChange={e => selMat(i, e.target.value)}
                  style={{ flex:2 }}
                >
                  <option value="">-- Select Material --</option>
                  {activeMats.map(m => (
                    <option key={m.id} value={m.id}>{m.name} ({m.quantity} {m.unit} left)</option>
                  ))}
                </select>
                <input 
                  type="number" 
                  className="form-input" 
                  value={row.qty} 
                  onChange={e => upMatRow(i, 'qty', e.target.value)} 
                  placeholder="Qty" 
                  style={{ flex:1 }}
                />
                <button className="btn btn-secondary" style={{ padding:'0 10px' }} onClick={() => removeMatRow(i)}>✕</button>
              </div>
            ))}
            <button className="btn btn-secondary" style={{ fontSize:12, padding:'4px 8px' }} onClick={addMatRow}>+ Add Material</button>
          </div>
        )}

        {/* Quality Check → Ready for Pickup: confirm QC */}
        {nextStage === 'Ready for Pickup' && (
          <div className="form-group">
            <label className="form-label" style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
              <input type="checkbox" checked={!!formData.qcPassed} onChange={e => setFormData(p => ({ ...p, qcPassed: e.target.checked }))} />
              I confirm this product has <strong style={{ marginLeft:4 }}>passed quality checking</strong>
            </label>
            {errors.qcPassed && <p className="field-error" style={{ marginTop:6 }}>{errors.qcPassed}</p>}
          </div>
        )}

        {nextStage === 'Quality Check' ? (
          <div className="form-group">
            <label className="form-label" style={{ fontWeight: 700, color: 'var(--black)' }}>THREAD TYPE and COLOR used</label>
            <input 
              className="form-input" 
              value={formData.threadName||''} 
              onChange={e => setFormData(p => ({ ...p, threadName: e.target.value }))} 
              placeholder="e.g. SEWING THREAD (BLACK)" 
              style={{ borderColor: 'var(--black)', borderWidth: 2 }}
            />
          </div>
        ) : (
          <div className="form-group">
            <label className="form-label">Stage Note <span style={{ color:'var(--gray-mid)', fontWeight:400 }}>(optional)</span></label>
            <input className="form-input" value={formData.note||''} onChange={e => setFormData(p => ({ ...p, note: e.target.value }))} placeholder="Any notes for this stage…" />
          </div>
        )}

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={closeStage}>Cancel</button>
          <button className="btn btn-primary" onClick={validateAndAdvance}>Proceed to {nextStage}</button>
        </div>
      </Modal>
    )
  }

  return (
    <div>
      <PageHeader 
        title="Production Tracking" 
        subtitle="Track each job order through all production stages"
        action={<button className="btn btn-secondary" onClick={refreshOrders} style={{ fontSize: 12, padding: '6px 12px' }}>🔄 Sync with JOS</button>}
      />

      <div className="production-board animate-fade-up">
        {PRODUCTION_STAGES.map((stage, si) => {
          const stageOrders = activeOrders.filter(o => getMappedStatus(o.status) === stage)
          const isLast = si === PRODUCTION_STAGES.length - 1
          return (
            <div key={stage} className="prod-col" style={{ animationDelay:`${si*45}ms` }}>
              <div className="prod-col__head">
                <span className="prod-col__stage">{stage}</span>
                <span className="prod-col__count">{stageOrders.length}</span>
              </div>
              <div className="prod-col__cards">
                {stageOrders.length === 0 && <div className="prod-empty">No orders</div>}
                {stageOrders.map(order => {
                  const daysLeft = getDaysUntil(order.deadline)
                  const totalPcs = (order.rows && order.rows.length > 0) 
                    ? order.rows.length 
                    : (order.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 1), 0)
                  return (
                    <div key={order.id} className={`prod-card ${daysLeft<=2?'prod-card--urgent':''}`}>
                      <div className="prod-card__top">
                        <span className="prod-card__id">{order.orderId}</span>
                        <Badge status={daysLeft<=2?'status-red':'status-gray'}>
                          {daysLeft<=0?'Overdue':`${daysLeft}d`}
                        </Badge>
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', gap:2, marginBottom:10 }}>
                        <span style={{ fontWeight:700, color:'var(--gray-dark)', fontSize:13 }}>{order.customer}</span>
                        {(order.teamName || order.design) && (
                          <span style={{ fontSize:11, color:'var(--gray-mid)' }}>
                            Team: {order.teamName || order.design}
                          </span>
                        )}
                        {order.productType && <span style={{ fontSize:10, color:'var(--primary)', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.02em' }}>{order.productType}</span>}
                      </div>
                      {order.design && order.design !== (order.teamName || order.design) && (
                        <p className="prod-card__design">{order.design}</p>
                      )}
                      <p style={{ fontSize:11, color:'var(--gray-mid)', marginBottom:6 }}>{totalPcs} pieces · Due {formatDate(order.deadline)}</p>
                      <div className="prod-card__footer">
                        {!isLast && (
                          si === 0 ? (
                            <span className="prod-card__status-msg">Awaiting JOS Payment</span>
                          ) : si === 1 ? (
                            <span className="prod-card__status-msg">Awaiting Final Design</span>
                          ) : (
                            <button className="prod-card__advance" onClick={() => openStage(order, si)}>
                              → Proceed to {PRODUCTION_STAGES[si+1]}
                            </button>
                          )
                        )}
                        {isLast && (
                          <div style={{ background:'#e8f5e9', border:'1px solid #c8e6c9', borderRadius:'var(--radius-sm)', padding:'6px 10px', fontSize:11, color:'#2e7d32', fontWeight:600, textAlign:'center' }}>
                            ✓ Ready for JOS Completion
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {renderStageModal()}
    </div>
  )
}

