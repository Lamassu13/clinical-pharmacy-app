import { useEffect, useRef } from 'react'
import ThemeToggle from './ThemeToggle.jsx'
import TopBarBrand from './TopBarBrand.jsx'

// The one top bar for every logged-in screen — the picker, the chart, the pills form and the
// four admin screens all mounted their own near-copies before. Three groups, kept apart: the
// brand (which is also "home"), the manager's admin sections behind one disclosure, and the
// user's own controls (theme, name, sign out).
const ADMIN_SECTIONS = [
  { view: 'requests', label: 'طلبات الانضمام', adminOnly: true },
  { view: 'medicines', label: 'إدارة الأدوية' },
  { view: 'floors', label: 'إدارة الطوابق' },
  { view: 'users', label: 'جميع المستخدمين' },
]

function Chevron() {
  return <svg className="admin-menu-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
}

// Manager/admin sections collapsed behind one deliberate target instead of four links sitting
// next to the chart, where a mis-tap dropped you out of the round. `<details>` carries the
// open state and keyboard toggle; Escape and an outside tap close it, to match the app's
// other overlays. Choosing a section re-renders App into that screen, which unmounts this.
function AdminMenu({ isAdmin, adminView, onNavigate }) {
  const ref = useRef(null)
  const sections = ADMIN_SECTIONS.filter((section) => isAdmin || !section.adminOnly)
  const current = sections.find((section) => section.view === adminView)

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const onPointerDown = (event) => { if (el.open && !el.contains(event.target)) el.open = false }
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && el.open) { el.open = false; el.querySelector('summary').focus() }
    }
    document.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('pointerdown', onPointerDown); el.removeEventListener('keydown', onKeyDown) }
  }, [])

  const go = (view) => { if (ref.current) ref.current.open = false; onNavigate(view) }

  return <details className="admin-menu" ref={ref}>
    <summary>
      <span>الإدارة{current && <span className="admin-menu-at"> · {current.label}</span>}</span>
      <Chevron />
    </summary>
    <div className="admin-menu-list">
      {sections.map((section) => (
        <button key={section.view} type="button" aria-current={adminView === section.view || undefined} onClick={() => go(section.view)}>
          {section.label}
        </button>
      ))}
      {adminView && <button type="button" className="admin-menu-exit" onClick={() => go(null)}>الخروج من الإدارة</button>}
    </div>
  </details>
}

export default function AppHeader({ theme, onToggleTheme, currentUser, onLogout, onHome, onMyWard, isAdmin, isManager, adminView, onNavigate }) {
  return <header className="topbar">
    <TopBarBrand onClick={onHome} />
    <nav className="user-menu" aria-label="أدوات الحساب">
      {onMyWard && <button type="button" className="secondary-button compact my-ward-button" onClick={onMyWard}>ردهتي اليوم</button>}
      {isManager && <AdminMenu isAdmin={isAdmin} adminView={adminView} onNavigate={onNavigate} />}
      {isManager && <span className="topbar-divider" aria-hidden="true" />}
      <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      <span className="topbar-user">{currentUser?.fullName || 'مستخدم'}</span>
      <button type="button" onClick={onLogout} className="text-button">تسجيل الخروج</button>
    </nav>
  </header>
}
