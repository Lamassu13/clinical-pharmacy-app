import { WardGlyph, CardStatus } from '../components/WardGlyph.jsx'
import WardActions from '../components/WardActions.jsx'

// استمارة الحبوب الإضافي was only built for these four floors' wards.
const EXTRA_PILLS_FLOORS = [3, 6, 8, 9]

// The sub-wards of one floor. Mirrors FloorPickerScreen's header and card shape so moving
// from the floor grid into a floor doesn't feel like a different screen. The floor number
// is in the heading, so the cards don't repeat it — each carries the ward glyph instead.
export default function WardPickerScreen({ floor, today, dashboard, dashboardError, onBack, onOpen }) {
  const startedWards = new Set(
    (dashboard?.startedWards ?? [])
      .filter((item) => item.floor === floor.number)
      .map((item) => item.ward),
  )

  return <section className="dashboard">
    <button className="back-button" onClick={onBack}>→ العودة للطوابق</button>
    <div className="section-heading">
      <div><h1>الطابق {floor.number}</h1></div>
      <div className="section-heading-actions">
        {EXTRA_PILLS_FLOORS.includes(floor.number) && (
          <button type="button" className="secondary-button compact" onClick={() => onOpen({ floor: floor.number, mode: 'extra-pills' })}>استمارة الحبوب الإضافي</button>
        )}
        {today && <div className="date-chip"><span>اليوم</span><strong>{today}</strong></div>}
      </div>
    </div>
    <div className="location-grid">{floor.wards.map((ward) => {
      const started = startedWards.has(ward)
      return <div className="location-card" key={ward}>
        <span className="floor-number"><WardGlyph /></span>
        <span className="location-card-body"><strong>{ward}</strong></span>
        {dashboard ? <CardStatus started={started} /> : dashboardError && <CardStatus unavailable />}
        <WardActions floor={floor.number} ward={ward} started={started} onOpen={onOpen} />
      </div>
    })}</div>
  </section>
}
