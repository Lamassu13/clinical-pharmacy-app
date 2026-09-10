// The action row on a ward / special-ward card. «الجارت» is the standing daily task, so it is
// the one prominent button; الإضافي / الحبوب / الطلبية fold behind a «…» the way the admin
// sections do, so a card is not four look-alike targets under a gloved thumb.
// `floor` is a number for a sub-ward, null for an independent ward.
export default function WardActions({ floor, ward, started, onOpen }) {
  const primaryClass = started ? 'secondary-button compact' : 'primary-button compact'
  return (
    <span className="ward-card-actions">
      <button className={primaryClass} onClick={() => onOpen({ floor, ward, mode: 'chart', slot: 'main' })}>الجارت</button>
      <details className="ward-card-more">
        <summary aria-label="خيارات أخرى للردهة">…</summary>
        <div className="ward-card-more-list">
          <button className="secondary-button compact" onClick={() => onOpen({ floor, ward, mode: 'chart', slot: 'extra' })}>الجارت الإضافي</button>
          <button className="secondary-button compact" onClick={() => onOpen({ floor, ward, mode: 'pills' })}>الحبوب</button>
          <button className="secondary-button compact" onClick={() => onOpen({ floor, ward, mode: 'order', slot: 'main' })}>الطلبية</button>
        </div>
      </details>
    </span>
  )
}
