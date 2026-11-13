import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import ThemeToggle from './ThemeToggle.jsx'
import TopBarBrand from './TopBarBrand.jsx'
import { Glyph } from './ToolbarIcons.jsx'

// The one top bar for every logged-in screen — the picker, the chart, the pills form and the
// four admin screens all mounted their own near-copies before. Three groups, kept apart: the
// brand (which is also "home"), the manager's admin sections behind one disclosure, and the
// user's own controls (theme, name, sign out).
// The admin sections in four groups, so the list reads as a map instead of nine items in the order they
// were added. `adminOnly` ones are hidden from a supervisor (an empty group goes with them).
const ADMIN_GROUPS = [
  { id: 'overview', label: 'نظرة عامة', sections: [
    { view: 'dashboard', label: 'لوحة التحكم' },
    { view: 'reports', label: 'التقارير' },
    { view: 'wardPositions', label: 'مواقف القسم' },
    { view: 'forms', label: 'متابعة الاستمارات' },
  ] },
  { id: 'people', label: 'المستخدمون', sections: [
    { view: 'requests', label: 'طلبات الانضمام', adminOnly: true, counted: true },
    { view: 'users', label: 'جميع المستخدمين' },
    { view: 'usage', label: 'استخدام المستخدمين' },
  ] },
  { id: 'setup', label: 'الإعداد', sections: [
    { view: 'medicines', label: 'إدارة الأدوية' },
    { view: 'floors', label: 'إدارة الطوابق' },
  ] },
  { id: 'watch', label: 'المراقبة', sections: [
    { view: 'audit', label: 'سجل الإدارة', adminOnly: true },
    { view: 'errors', label: 'الأخطاء', adminOnly: true },
  ] },
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

// `pendingRequests`: sign-up requests waiting for the admin, shown on «طلبات الانضمام»; `onOpen` asks
// App to refresh that number each time the menu is opened.
function AdminMenu({ isAdmin, adminView, onNavigate, pendingRequests = 0, onOpen }) {
  const ref = useRef(null)
  const groups = ADMIN_GROUPS.map((group) => ({ ...group, sections: group.sections.filter((section) => isAdmin || !section.adminOnly) })).filter((group) => group.sections.length)
  const current = groups.flatMap((group) => group.sections).find((section) => section.view === adminView)
  useDismiss(ref)

  const go = (view) => { if (ref.current) ref.current.open = false; onNavigate(view) }

  return <details className="admin-menu" ref={ref} onToggle={(event) => { if (event.currentTarget.open) onOpen?.() }}>
    <summary>
      <Glyph icon="admin" />
      <span className="tb-label">الإدارة{current && <span className="admin-menu-at"> · {current.label}</span>}</span>
      <Chevron />
    </summary>
    <div className="admin-menu-list">
      {groups.map((group) => (
        <div key={group.id} className="admin-menu-group" role="group" aria-labelledby={`admin-menu-${group.id}`}>
          <span className="admin-menu-group-label" id={`admin-menu-${group.id}`}>{group.label}</span>
          {group.sections.map((section) => (
            <button key={section.view} type="button" aria-current={adminView === section.view || undefined} onClick={() => go(section.view)}>
              <span>{section.label}</span>
              {section.counted && pendingRequests > 0 && <span className="admin-menu-count">{pendingRequests}<span className="sr-only"> بانتظار الموافقة</span></span>}
            </button>
          ))}
        </div>
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

// Phone / iPad only (CSS shows it ≤1024px): the places a pharmacist moves between, in the
// thumb zone instead of the top corner. The top bar keeps brand, status and the admin sections.
let lastGlide = null // where the glass capsule was on the last bar drawn: { x, width }
// A floor pharmacist's bar (`wardTabs`, set by App.jsx): their floor (the ward list) and each of its wards, no account tab —
// the account is in the top bar. A manager's: home, reports, admin and the account.
function BottomNav({ adminView, isManager, onHome, onMyWard, onNavigate, onOpenProfile, wardTabs, formsTab, homeActive }) {
  useEffect(() => {
    document.body.classList.add('has-bottom-nav')
    // iOS can leave a fixed bar floating mid-screen after the keyboard closes (the layout viewport keeps
    // its shrunken height). A 1px scroll nudge, a frame apart, makes WebKit re-lay it out. It runs 300ms
    // after the last focus change AND after the last viewport resize (the keyboard's closing animation
    // can outlast the first delay), never while a field is focused or the page is pinch-zoomed.
    // Harmless elsewhere.
    let timer
    const nudge = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return
        if (window.visualViewport && window.visualViewport.scale > 1.01) return
        window.scrollBy(0, 1)
        requestAnimationFrame(() => window.scrollBy(0, -1))
      }, 300)
    }
    const viewport = window.visualViewport
    document.addEventListener('focusout', nudge)
    viewport?.addEventListener('resize', nudge)
    return () => { clearTimeout(timer); document.removeEventListener('focusout', nudge); viewport?.removeEventListener('resize', nudge); document.body.classList.remove('has-bottom-nav') }
  }, [])
  const adminActive = isManager && adminView && adminView !== 'profile' && adminView !== 'reports'
  const tabs = wardTabs ? [
    { key: 'home', icon: 'home', label: 'الرئيسية', active: homeActive, onClick: onMyWard || onHome },
    ...wardTabs.map((tab) => ({ key: `ward:${tab.ward}`, icon: 'ward', label: tab.ward, active: tab.active, onClick: tab.onClick })),
    // The floor's six forms in one screen (a floor pharmacist only: it needs the floor).
    formsTab && { key: 'forms', icon: 'forms', label: 'مواقف القسم', active: formsTab.active, onClick: formsTab.onClick },
  ].filter(Boolean) : [
    { key: 'home', icon: 'home', label: 'الرئيسية', active: !adminView, onClick: onHome },
    onMyWard && { key: 'ward', icon: 'ward', label: 'ردهتي', onClick: onMyWard },
    isManager && { key: 'reports', icon: 'reports', label: 'التقارير', active: adminView === 'reports', onClick: () => onNavigate('reports') },
    isManager && { key: 'admin', icon: 'admin', label: 'الإدارة', active: adminActive, onClick: () => onNavigate(adminActive ? adminView : 'dashboard') },
    { key: 'profile', icon: 'account', label: 'حسابي', active: adminView === 'profile', onClick: onOpenProfile },
  ].filter(Boolean)
  // The glass capsule is one element that glides to the open tab (and stretches on the way, like the reference), instead of
  // each tab painting its own: its place is measured from the open tab's button, and moved by CSS.
  const navRef = useRef(null)
  // The bar steps out of the way while a field is being typed in: on a phone the keyboard and the bar together took the screen the
  // chart's cell was on. It slides back when the field loses focus (a short wait, so tapping from one field to the next does not flicker).
  const [typing, setTyping] = useState(false)
  useEffect(() => {
    let timer
    const isField = (element) => Boolean(element) && (/^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName) || element.isContentEditable)
    const onFocusIn = (event) => { if (isField(event.target)) { clearTimeout(timer); setTyping(true) } }
    const onFocusOut = () => { clearTimeout(timer); timer = setTimeout(() => setTyping(isField(document.activeElement)), 200) }
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    return () => { clearTimeout(timer); document.removeEventListener('focusin', onFocusIn); document.removeEventListener('focusout', onFocusOut) }
  }, [])
  const activeKey = tabs.find((tab) => tab.active)?.key || ''
  // Each screen draws its own bar, so a tap that opens another screen builds a new one: it starts where the last one's capsule was
  // (`lastGlide`, kept outside React) and glides from there, so the travel is seen across screens too.
  const [glide, setGlide] = useState(() => lastGlide) // { x, width } of the open tab; null when none is open
  const [glideReady, setGlideReady] = useState(false) // travel is switched on a frame after the first place is set
  const tabKeys = tabs.map((tab) => tab.key).join('|')
  useLayoutEffect(() => {
    const target = () => {
      const button = navRef.current?.querySelector('button[aria-current="page"]')
      return button ? { x: button.offsetLeft, width: button.offsetWidth } : null
    }
    let second
    const first = requestAnimationFrame(() => {
      setGlideReady(true)
      second = requestAnimationFrame(() => { lastGlide = target(); setGlide(lastGlide) })
    })
    // Before the first frame: the place it starts from (the last bar's), or the open tab's own when there was none.
    if (!lastGlide) { lastGlide = target(); setGlide(lastGlide) }
    const place = () => { lastGlide = target(); setGlide(lastGlide) }
    window.addEventListener('resize', place)
    // (Only while a font is still loading, when the tabs' widths can still change: an already-loaded one resolves at once, and that would jump the capsule before it travels.)
    if (document.fonts?.status === 'loading') document.fonts.ready.then(place)
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); window.removeEventListener('resize', place) }
  }, [activeKey, tabKeys])
  return <nav className="bottom-nav" aria-label="التنقل الرئيسي" ref={navRef} data-typing={typing || undefined} data-crowded={tabs.length > 4 || undefined} data-glide={glide && glideReady ? 'on' : glide ? 'set' : 'off'}>
    {/* (physical `left`: the place comes from offsetLeft, which counts from the left in either direction) */}
    <span className="bottom-nav-glide" aria-hidden="true" style={glide ? { transform: `translateX(${glide.x}px)`, width: glide.width } : undefined}>
      <i key={activeKey} />
    </span>
    {tabs.map((tab) => (
      <button key={tab.key} type="button" aria-current={tab.active ? 'page' : undefined} onClick={tab.onClick}>
        <Glyph icon={tab.icon} /><span>{tab.label}</span>
      </button>
    ))}
  </nav>
}

export default function AppHeader({ theme, onToggleTheme, currentUser, onLogout, onHome, onMyWard, onOpenProfile, wardTabs, formsTab, homeActive, isAdmin, isManager, adminView, onNavigate, isOnline, pendingWrites = 0, pendingRequests = 0, onAdminMenuOpen }) {
  return <><header className="topbar">
    <TopBarBrand onClick={onHome} />
    <nav className="user-menu" aria-label="أدوات الحساب">
      {/* One clear top-level state instead of a per-screen chip: chart/pills/extra-pills each
          already say "not saved yet" on their own, this just names *why* when it's connectivity
          rather than a slow save. */}
      {isOnline === false ? <span className="offline-badge" role="status">○ غير متصل — سيُرفع تلقائيًا</span>
        : pendingWrites > 0 && <span className="offline-badge" role="status">↻ {pendingWrites} بانتظار الرفع</span>}
      {onMyWard && <button type="button" className="secondary-button compact my-ward-button desktop-only" onClick={onMyWard}>ردهتي اليوم</button>}
      {isManager && <AdminMenu isAdmin={isAdmin} adminView={adminView} onNavigate={onNavigate} pendingRequests={pendingRequests} onOpen={onAdminMenuOpen} />}
      {isManager && <span className="topbar-divider" aria-hidden="true" />}
      <span className="desktop-only"><ThemeToggle theme={theme} onToggle={onToggleTheme} /></span>
      <button type="button" className="topbar-user desktop-only" aria-current={adminView === 'profile' || undefined} onClick={onOpenProfile}>{currentUser?.fullName || 'مستخدم'}</button>
      <button type="button" onClick={onLogout} className="text-button desktop-only">تسجيل الخروج</button>
      <AccountMenu theme={theme} onToggleTheme={onToggleTheme} currentUser={currentUser} onLogout={onLogout} onMyWard={onMyWard} onOpenProfile={onOpenProfile} adminView={adminView} />
    </nav>
  </header>
  <BottomNav adminView={adminView} isManager={isManager} onHome={onHome} onMyWard={onMyWard} onNavigate={onNavigate} onOpenProfile={onOpenProfile} wardTabs={wardTabs} formsTab={formsTab} homeActive={homeActive} />
  </>
}
