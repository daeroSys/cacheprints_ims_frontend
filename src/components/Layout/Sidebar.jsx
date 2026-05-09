import { useAuth } from '../../context/AuthContext'
import './Sidebar.css'

const ALL_NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: '◈', staffOk: true },
  { key: 'materials', label: 'Materials', icon: '⬡', staffOk: true },
  { key: 'stock', label: 'Stock Levels', icon: '▦', staffOk: true },
  { key: 'purchases', label: 'Purchases', icon: '⊕', staffOk: true },
  { key: 'transactions', label: 'Inventory Transactions', icon: '⇅', staffOk: true },
  { key: 'orders', label: 'Job Orders', icon: '◻', staffOk: true },
  { key: 'production', label: 'Production Tracking', icon: '◎', staffOk: true },
  { key: 'designs', label: 'Design Files', icon: '✎', staffOk: true },
  { key: 'reports', label: 'Reports', icon: '⊞', staffOk: true },
  { key: 'archive', label: 'Archive', icon: '⊟', staffOk: false },
  { key: 'activity', label: 'Activity Log', icon: '≡', staffOk: false },
  { key: 'users', label: 'Users', icon: '◉', staffOk: false },
  { key: 'settings', label: 'Settings', icon: '◬', staffOk: false },
]

export default function Sidebar({ active, onNav, lowStockCount }) {
  const { currentUser } = useAuth()
  const isAdmin = currentUser?.role === 'Admin'
  const NAV = ALL_NAV.filter(item => isAdmin || item.staffOk)
  return (
    <aside className="sidebar">
      <div className="sidebar__logo-wrap">
        <img
          src="/CachePrints_Logo.png"
          alt="CachePrints Logo"
          className="sidebar__logo-img"
        />
        <p className="sidebar__app-name">Inventory Management System</p>
      </div>
      <nav className="sidebar__nav">
        <p className="sidebar__nav-label">Menu</p>
        {NAV.map((item, i) => (
          <button key={item.key}
            className={`sidebar__item ${active === item.key ? 'sidebar__item--active' : ''}`}
            onClick={() => onNav(item.key)}
            style={{ animationDelay: `${i * 35}ms` }}
          >
            <span className="sidebar__item-icon">{item.icon}</span>
            <span className="sidebar__item-label">{item.label}</span>
            {item.key === 'stock' && lowStockCount > 0 && <span className="sidebar__badge">{lowStockCount}</span>}
          </button>
        ))}
      </nav>
      <div className="sidebar__footer">
        <div className="sidebar__footer-avatar">
          {(currentUser?.name || currentUser?.username || 'A').slice(0, 2).toUpperCase()}
        </div>
        <div className="sidebar__footer-info">
          <p className="sidebar__footer-name">{currentUser?.name || currentUser?.username || 'Admin'}</p>
          <p className="sidebar__footer-role">{currentUser?.role || 'Admin'}</p>
        </div>
      </div>
    </aside>
  )
}
