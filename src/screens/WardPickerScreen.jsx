import { WardGlyph, StatusCheck } from '../components/WardGlyph.jsx'

function CardStatus({ started }) {
  return started
    ? <span className="card-status card-status--done"><StatusCheck /> بدأت</span>
    : <span className="card-status card-status--pending">لم تبدأ</span>
}

// The sub-wards of one floor. Mirrors FloorPickerScreen's header and card shape so moving
// from the floor grid into a floor doesn't feel like a different screen. The floor number
// is in the heading, so the cards don't repeat it — each carries the ward glyph instead.
export default function WardPickerScreen({ floor, today, dashboard, isManager, onBack, onOpen }) {
  const startedWards = new Set(
    (dashboard?.startedWards ?? [])
      .filter((item) => item.floor === floor.number)
      .map((item) => item.ward),
  )

  return <section className="dashboard">
    <button className="back-button" onClick={onBack}>→ العودة للطوابق</button>
    <div className="section-heading">
      <div><h1>الطابق {floor.number}</h1></div>
      {today && <div className="date-chip"><span>اليوم</span><strong>{today}</strong></div>}
    </div>
    <div className="location-grid">{floor.wards.map((ward) => {
      const started = startedWards.has(ward)
      return <div className="location-card" key={ward}>
        <span className="floor-number"><WardGlyph /></span>
        <span className="location-card-body"><strong>{ward}</strong></span>
        {isManager && <CardStatus started={started} />}
        <span className="ward-card-actions">
          <button className="secondary-button compact" onClick={() => onOpen({ floor: floor.number, ward, mode: 'chart', slot: 'main' })}>الجارت</button>
          <button className="secondary-button compact" onClick={() => onOpen({ floor: floor.number, ward, mode: 'chart', slot: 'extra' })}>الجارت الإضافي</button>
          <button className="primary-button compact" onClick={() => onOpen({ floor: floor.number, ward, mode: 'pills' })}>الحبوب</button>
        </span>
      </div>
    })}</div>
  </section>
}
