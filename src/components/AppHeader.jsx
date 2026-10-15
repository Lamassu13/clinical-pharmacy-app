import { useEffect, useRef } from 'react'
import ThemeToggle from './ThemeToggle.jsx'
import TopBarBrand from './TopBarBrand.jsx'
import { Glyph } from './ToolbarIcons.jsx'

// The one top bar for every logged-in screen — the picker, the chart, the pills form and the
// four admin screens all mounted their own near-copies before. Three groups, kept apart: the
// brand (which is also "home"), the manager's admin sections behind one disclosure, and the
// user's own controls (theme, name, sign out).
const ADMIN_SECTIONS = [
  { view: 'dashboard', label: 'لوحة التحكم' },
  { view: 'requests', label: 'طلبات الانضمام', adminOnly: true },
  { view: 'medicines', label: 'إدارة الأدوية' },
  { view: 'floors', label: 'إدارة الطوابق' },
  { view: 'reports', label: 'التقارير' },
  { view: 'users', label: 'جميع المستخدمين' },
]

function Chevron() {
  return <svg className="admin-menu-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
}

// Manager/admin sections collapsed behind one deliberate target instead of four links sitting
// next to the chart, where a mis-tap dropped you out of the round. `<details>` carries the
// open state and keyboard toggle; Escape and an outside tap close it, to match the app's
// other overlays. Choosing a section re-renders App into that screen, which unmounts this.
// Escape and an outside tap close a <details> menu (shared by the admin and account menus).
function useDismiss(ref) {
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
  }, [ref])
}

function AdminMenu({ isAdmin, adminView, onNavigate }) {
  const ref = useRef(null)
  const sections = ADMIN_SECTIONS.filter((section) => isAdmin || !section.adminOnly)
  const current = sections.find((section) => section.view === adminView)
  useDismiss(ref)

  const go = (view) => { if (ref.current) ref.current.open = false; onNavigate(view) }

  return <details className="admin-menu" ref={ref}>
    <summary>
      <Glyph icon="admin" />
      <span className="tb-label">الإدارة{current && <span className="admin-menu-at"> · {current.label}</span>}</span>
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

// Phone only (the desktop row shows these controls inline, see .account-menu in App.css): the
// name, theme, «ردهتي اليوم» and sign-out folded behind one round button with the user's initial.
function AccountMenu({ theme, onToggleTheme, currentUser, onLogout, onMyWard, onOpenProfile, adminView }) {
  const ref = useRef(null)
  useDismiss(ref)
  const name = currentUser?.fullName || 'مستخدم'
  const run = (action) => () => { if (ref.current) ref.current.open = false; action() }
  return <details className="account-menu" ref={ref}>
    <summary aria-label={`الحساب: ${name}`}>{[...name.trim()][0]?.toUpperCase() || '؟'}</summary>
    <div className="admin-menu-list">
      <button type="button" aria-current={adminView === 'profile' || undefined} onClick={run(onOpenProfile)}>{name}</button>
      {onMyWard && <button type="button" onClick={run(onMyWard)}>ردهتي اليوم</button>}
      <button type="button" onClick={onToggleTheme} aria-pressed={theme === 'dark'}>{theme === 'dark' ? 'إيقاف الوضع الليلي' : 'تشغيل الوضع الليلي'}</button>
      <button type="button" className="admin-menu-exit" onClick={run(onLogout)}>تسجيل الخروج</button>
    </div>
  </details>
}

export default function AppHeader({ theme, onToggleTheme, currentUser, onLogout, onHome, onMyWard, onOpenProfile, isAdmin, isManager, adminView, onNavigate, isOnline, pendingWrites = 0 }) {
  return <header className="topbar">
    <TopBarBrand onClick={onHome} />
    <nav className="user-menu" aria-label="أدوات الحساب">
      {/* One clear top-level state instead of a per-screen chip: chart/pills/extra-pills each
          already say "not saved yet" on their own, this just names *why* when it's connectivity
          rather than a slow save. */}
      {isOnline === false ? <span className="offline-badge" role="status">○ غير متصل — سيُرفع تلقائيًا</span>
        : pendingWrites > 0 && <span className="offline-badge" role="status">↻ {pendingWrites} بانتظار الرفع</span>}
      {onMyWard && <button type="button" className="secondary-button compact my-ward-button desktop-only" onClick={onMyWard}>ردهتي اليوم</button>}
      <button type="button" className="secondary-button compact forms-button" aria-label="استمارات العلاج" aria-current={adminView === 'forms' || undefined} onClick={() => onNavigate('forms')}><Glyph icon="forms" /><span className="tb-label">استمارات العلاج</span></button>
      {isManager && <AdminMenu isAdmin={isAdmin} adminView={adminView} onNavigate={onNavigate} />}
      {isManager && <span className="topbar-divider" aria-hidden="true" />}
      <span className="desktop-only"><ThemeToggle theme={theme} onToggle={onToggleTheme} /></span>
      <button type="button" className="topbar-user desktop-only" aria-current={adminView === 'profile' || undefined} onClick={onOpenProfile}>{currentUser?.fullName || 'مستخدم'}</button>
      <button type="button" onClick={onLogout} className="text-button desktop-only">تسجيل الخروج</button>
      <AccountMenu theme={theme} onToggleTheme={onToggleTheme} currentUser={currentUser} onLogout={onLogout} onMyWard={onMyWard} onOpenProfile={onOpenProfile} adminView={adminView} />
    </nav>
  </header>
}
