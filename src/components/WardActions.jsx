import { useEffect, useRef } from 'react'

// استمارة الحبوب الإضافي was only built for these four floors' wards — an independent/special
// ward (floor null) never gets it, same as the server's own floor CHECK constraint.
const EXTRA_PILLS_FLOORS = [3, 6, 8, 9]

// The action row on a ward / special-ward card. «الجارت» is the standing daily task, so it is
// the one prominent button; الإضافي / الحبوب / الطلبية / استمارة الحبوب الإضافي fold behind a
// «…» the way the admin sections do, so a card is not five look-alike targets under a gloved
// thumb. Same outside-click/Escape/focus-return handling as AppHeader's AdminMenu — this one
// renders once per ward card (up to ~26 on a manager's screen), so without it a fumbled tap on
// a shared tablet can leave several of these open across the grid at once.
// `floor` is a number for a sub-ward, null for an independent ward.
export default function WardActions({ floor, ward, started, onOpen }) {
  const primaryClass = started ? 'secondary-button compact' : 'primary-button compact'
  const ref = useRef(null)

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
          <button className="secondary-button compact" onClick={() => { ref.current.open = false; onOpen({ floor, ward, mode: 'chart', slot: 'extra' }) }}>الجارت الإضافي</button>
          <button className="secondary-button compact" onClick={() => { ref.current.open = false; onOpen({ floor, ward, mode: 'pills' }) }}>الحبوب</button>
          <button className="secondary-button compact" onClick={() => { ref.current.open = false; onOpen({ floor, ward, mode: 'order', slot: 'main' }) }}>الطلبية</button>
          <button className="secondary-button compact" onClick={() => { ref.current.open = false; onOpen({ floor, ward, mode: 'meropenem' }) }}>متابعة الميروبينيم</button>
          {floor && EXTRA_PILLS_FLOORS.includes(floor) && (
            <button className="secondary-button compact" onClick={() => { ref.current.open = false; onOpen({ floor, ward, mode: 'extra-pills' }) }}>استمارة الحبوب الإضافي</button>
          )}
        </div>
      </details>
    </span>
  )
}
