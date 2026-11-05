// The shortcut on a ward / special-ward card. «الجارت» is the standing daily task, so it stays one
// tap from the list; everything else the ward offers is on the ward's own page (the card body
// opens it — see WardHubScreen). `floor` is a number for a sub-ward, null for an independent ward.
export default function WardActions({ floor, ward, started, onOpen }) {
  return (
    <span className="ward-card-actions">
      <button className={started ? 'secondary-button compact' : 'primary-button compact'} aria-label={`الجارت — ${ward}`} onClick={() => onOpen({ floor, ward, mode: 'chart', slot: 'main' })}>الجارت</button>
    </span>
  )
}
