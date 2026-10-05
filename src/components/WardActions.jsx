import { useEffect, useId, useRef } from 'react'

// استمارة الحبوب الإضافي was only built for these four floors' wards — an independent/special
// ward (floor null) never gets it, same as the server's own floor CHECK constraint.
const EXTRA_PILLS_FLOORS = [3, 6, 8, 9]

// The action row on a ward / special-ward card. «الجارت» is the standing daily task, so it is
// the one prominent button; الإضافي / الحبوب / الطلبية / استمارة الحبوب الإضافي fold behind a
// «…» the way the admin sections do, so a card is not five look-alike targets under a gloved
// thumb. Same outside-click/Escape/focus-return handling as AppHeader's AdminMenu — this one
// renders once per ward card (up to ~26 on a manager's screen), so without it a fumbled tap on
// a shared tablet can leave several of these open across the grid at once.
// The «…» list: daily forms, then clinical follow-up — plain rows with an icon, not a stack of
// look-alike buttons. `open` is merged into { floor, ward } and handed to onOpen as is.
const GROUPS = [
  { id: 'forms', label: 'الاستمارات اليومية', items: [
    { label: 'الجارت الإضافي', icon: 'sheet-plus', open: { mode: 'chart', slot: 'extra' } },
    { label: 'الحبوب', icon: 'pill', open: { mode: 'pills' } },
    { label: 'الطلبية', icon: 'clipboard', open: { mode: 'order', slot: 'main' } },
    { label: 'طلبية الميرونيم', icon: 'clipboard', open: { mode: 'meropenem-order', slot: 'main' } },
    { label: 'استمارة الحبوب الإضافي', icon: 'pill-sheet', open: { mode: 'extra-pills' }, show: (floor) => Boolean(floor && EXTRA_PILLS_FLOORS.includes(floor)) },
  ] },
  { id: 'clinical', label: 'المتابعة السريرية', items: [
    { label: 'متابعة الميروبينيم', icon: 'vial', open: { mode: 'meropenem' } },
    { label: 'متابعة المضادات الحيوية', icon: 'calendar', open: { mode: 'antibiotics' } },
    { label: 'التداخلات الدوائية', icon: 'overlap', open: { mode: 'interactions' } },
    { label: 'تعديل الجرعة الكلوية', icon: 'kidney', open: { mode: 'renal' } },
  ] },
]

// One stroke family with the rest of the app: 24-grid, 1.75 stroke, round caps, a 0.14 tint fill.
const TINT = { fill: 'currentColor', fillOpacity: 0.14, stroke: 'none' }
const ICONS = {
  'sheet-plus': <><rect x="4.5" y="3.5" width="15" height="17" rx="2" {...TINT} /><rect x="4.5" y="3.5" width="15" height="17" rx="2" /><path d="M8 8.5h8M8 12h4M15.5 13.5v5M13 16h5" /></>,
  pill: <><rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-35 12 12)" {...TINT} /><rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-35 12 12)" /><path d="M9.7 8.7l4.6 6.6" /></>,
  clipboard: <><rect x="5" y="4.5" width="14" height="16" rx="2" {...TINT} /><rect x="5" y="4.5" width="14" height="16" rx="2" /><path d="M9 4.5V3.5h6v1M8.5 10h7M8.5 13.5h7M8.5 17h4" /></>,
  'pill-sheet': <><rect x="4.5" y="3.5" width="15" height="17" rx="2" {...TINT} /><rect x="4.5" y="3.5" width="15" height="17" rx="2" /><rect x="8" y="10" width="8" height="4" rx="2" /><path d="M12 10v4M8 6.5h8M8 17h5" /></>,
  vial: <><path d="M9 3.5h6M10 3.5v3l-1.5 2.5v9.5a2 2 0 0 0 2 2h3a2 2 0 0 0 2-2V9L14 6.5v-3" /><path d="M8.5 12.5h7v6a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2z" {...TINT} /><path d="M8.5 12.5h7" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2" {...TINT} /><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 9.5h17M8 3v4M16 3v4M7.5 13.5h2M11 13.5h2M14.5 13.5h2M7.5 17h2M11 17h2" /></>,
  overlap: <><circle cx="9" cy="12" r="5.5" {...TINT} /><circle cx="15" cy="12" r="5.5" {...TINT} /><circle cx="9" cy="12" r="5.5" /><circle cx="15" cy="12" r="5.5" /></>,
  kidney: <><path d="M15.5 3.5c-3.6 0-6 3-6 5.4 0 1.4 1.4 1.9 1.4 3.1s-1.4 1.7-1.4 3.1c0 2.4 2.4 5.4 6 5.4 3 0 5-3.6 5-8.5s-2-8.5-5-8.5z" {...TINT} /><path d="M15.5 3.5c-3.6 0-6 3-6 5.4 0 1.4 1.4 1.9 1.4 3.1s-1.4 1.7-1.4 3.1c0 2.4 2.4 5.4 6 5.4 3 0 5-3.6 5-8.5s-2-8.5-5-8.5z" /><path d="M10.9 12H6.5a3 3 0 0 0-3 3v1.5" /></>,
}
const Icon = ({ name }) => <svg className="ward-menu-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]}</svg>

// `floor` is a number for a sub-ward, null for an independent ward.
export default function WardActions({ floor, ward, started, onOpen }) {
  const primaryClass = started ? 'secondary-button compact' : 'primary-button compact'
  const ref = useRef(null)
  const menuId = useId()

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

  return (
    <span className="ward-card-actions">
      <button className={primaryClass} onClick={() => onOpen({ floor, ward, mode: 'chart', slot: 'main' })}>الجارت</button>
      <details className="ward-card-more" ref={ref}>
        <summary aria-label="خيارات أخرى للردهة">…</summary>
        <div className="ward-card-more-list">
          {GROUPS.map((group) => {
            const items = group.items.filter((item) => !item.show || item.show(floor))
            return <div key={group.id} className="ward-menu-group" role="group" aria-labelledby={`${menuId}-${group.id}`}>
              <p className="ward-menu-label" id={`${menuId}-${group.id}`}>{group.label}</p>
              {items.map((item) => <button key={item.label} type="button" className="ward-menu-item" onClick={() => { ref.current.open = false; onOpen({ floor, ward, ...item.open }) }}>
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </button>)}
            </div>
          })}
        </div>
      </details>
    </span>
  )
}
