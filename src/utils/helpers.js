export const formatCurrency = (amount) =>
  new Intl.NumberFormat('en-PH', { style:'currency', currency:'PHP', minimumFractionDigits:0 }).format(amount || 0)

export const formatDate = (dateStr) => {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-PH', { year:'numeric', month:'short', day:'numeric' })
}

export const formatDateTime = (isoStr) => {
  if (!isoStr) return '—'
  return new Date(isoStr).toLocaleString('en-PH', { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })
}

export const generateId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`

export const getDaysUntil = (dateStr) => {
  const diff = new Date(dateStr) - new Date()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

export const getStatusColor = (status) => {
  const map = {
    'Order Received':'status-gray','Designing':'status-blue','Sublimation Printing':'status-yellow',
    'Sewing':'status-purple','Quality Check':'status-orange','Ready for Pickup':'status-green',
    'Paid':'status-green','Partial':'status-yellow','Unpaid':'status-red',
    'Stock-In':'status-green','Stock-Out':'status-red','Adjustment':'status-yellow',
    'Completed':'status-green','Archived':'status-gray',
  }
  return map[status] || 'status-gray'
}

export const isLowStock = (m) => m.quantity <= m.minQty

export const sumSizes = (sizes) => Object.values(sizes || {}).reduce((a, v) => a + (Number(v) || 0), 0)

export const computeOrderTotal = (order, product) => {
  if (!product) return 0
  const uQty = sumSizes(order.upperSizes)
  const lQty = sumSizes(order.lowerSizes)
  const bQty = order.includeBanner ? uQty + lQty : 0
  return uQty * (product.upperPrice || 0) + lQty * (product.lowerPrice || 0) + bQty * (product.bannerPrice || 0)
}

export const derivePaymentStatus = (paid, total) => {
  const p = Number(paid) || 0
  const t = Number(total) || 0
  if (p <= 0) return 'Unpaid'
  if (p >= t) return 'Paid'
  return 'Partial'
}

export const nowISO = () => new Date().toISOString()

export const toLocalISO = (date) => {
  const d = new Date(date)
  const offset = d.getTimezoneOffset()
  const localDate = new Date(d.getTime() - (offset * 60 * 1000))
  return localDate.toISOString().split('T')[0]
}

export const PERIOD_PRESETS = [
  { key: 'today',      label: 'Today' },
  { key: 'yesterday',  label: 'Yesterday' },
  { key: 'this-week',  label: 'This Week' },
  { key: 'this-month', label: 'This Month' },
  { key: 'all-time',   label: 'All Time' },
  { key: 'custom',     label: 'Custom Range' },
]

export function getPresetRange(key) {
  const now = new Date()
  switch (key) {
    case 'today': {
      const d = new Date(now); d.setHours(0,0,0,0)
      const e = new Date(now); e.setHours(23,59,59,999)
      return { from: d, to: e }
    }
    case 'yesterday': {
      const d = new Date(now); d.setDate(now.getDate() - 1); d.setHours(0,0,0,0)
      const e = new Date(now); e.setDate(now.getDate() - 1); e.setHours(23,59,59,999)
      return { from: d, to: e }
    }
    case 'this-week': {
      const s = new Date(now); s.setDate(now.getDate() - now.getDay()); s.setHours(0,0,0,0)
      const e = new Date(s); e.setDate(s.getDate() + 6); e.setHours(23,59,59,999)
      return { from: s, to: e }
    }
    case 'this-month': {
      const s = new Date(now.getFullYear(), now.getMonth(), 1); s.setHours(0,0,0,0)
      const e = new Date(now.getFullYear(), now.getMonth() + 1, 0); e.setHours(23,59,59,999)
      return { from: s, to: e }
    }
    case 'all-time': {
      return { from: new Date(2000, 0, 1), to: new Date(now.getFullYear() + 10, 0, 1) }
    }
    default: return null
  }
}

export function inRange(dateStr, from, to) {
  if (!dateStr) return false
  const d = new Date(dateStr)
  return d >= from && d <= to
}
