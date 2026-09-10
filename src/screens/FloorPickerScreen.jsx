import { floors, specialWards } from '../constants.js'
import DashboardWidgets, { WardStatusBand } from '../components/DashboardWidgets.jsx'
import { WardGlyph, ChevronStart, StatusCheck, CardStatus } from '../components/WardGlyph.jsx'

// The floor/special-ward grid. Which cards a given user may actually see is applied
// imperatively by an effect in App (it hides cards outside their assignment), so this
// renders all of them.
export default function FloorPickerScreen({
  today, onPickFloor, onOpen, dashboard, dashboardLoading, dashboardError, onRetryDashboard,
  announcements, isManager,
  medicinesPeriod, setMedicinesPeriod,
  announcementDraft, setAnnouncementDraft, announcementError, announcementBusy,
  onPostAnnouncement, onEditAnnouncement, onDeleteAnnouncement,
}) {
  // Count at ward granularity, not floor: a floor with one of three wards started is one
  // third done, and the two that haven't are exactly what the morning round is there to
  // catch. One key per started ward — a ward with both a main and an extra chart comes back
  // from the dashboard twice.
  const startedKeys = new Set((dashboard?.startedWards ?? []).map((item) => `${item.floor ?? 'x'}|${item.ward}`))
  const floorStarted = (floor) => floor.wards.filter((ward) => startedKeys.has(`${floor.number}|${ward}`)).length
  const startedSpecialWards = new Set(specialWards.filter((ward) => startedKeys.has(`x|${ward}`)))
  const totalCount = floors.reduce((sum, floor) => sum + floor.wards.length, 0) + specialWards.length
  const startedCount = floors.reduce((sum, floor) => sum + floorStarted(floor), 0) + startedSpecialWards.size
  // Each pending entry carries what it takes to route there: a floor object drills into its
  // ward list; a special ward (floor: null) opens its chart directly.
  const notStarted = [
    ...floors.flatMap((floor) => floor.wards
      .filter((ward) => !startedKeys.has(`${floor.number}|${ward}`))
      .map((ward) => ({ label: `الطابق ${floor.number} — ${ward}`, floor, ward }))),
    ...specialWards
      .filter((ward) => !startedSpecialWards.has(ward))
      .map((ward) => ({ label: ward, floor: null, ward })),
  ]

  // For a manager reading the band, the grid is a second copy of the same 26 wards — so lead
  // with the floors that still need pushing and fold the finished ones out of the way.
  const managerView = isManager && dashboard
  const pendingFloors = managerView ? floors.filter((floor) => floorStarted(floor) < floor.wards.length) : floors
  const doneFloors = managerView ? floors.filter((floor) => floorStarted(floor) === floor.wards.length) : []

  const floorCard = (floor) => (
    <button className="location-card location-card--link" key={floor.number} onClick={() => onPickFloor(floor)}>
      <span className="floor-number">{floor.number}</span>
      <span className="location-card-body"><strong>الطابق {floor.number}</strong><small>{floor.wards.length} أروقة فرعية</small></span>
      {dashboard ? <CardStatus done={floorStarted(floor)} total={floor.wards.length} /> : dashboardError && <CardStatus unavailable />}
      <span className="arrow"><ChevronStart /></span>
    </button>
  )

  return <section className="dashboard">
    <div className="section-heading">
      <div><h1>اختر الطابق أو الردهة</h1></div>
      <div className="date-chip"><span>اليوم</span><strong>{today}</strong></div>
    </div>

    {isManager && (
      <WardStatusBand
        startedCount={startedCount} totalCount={totalCount} notStarted={notStarted}
        onPickFloor={onPickFloor} onOpen={onOpen}
        loading={dashboardLoading} error={dashboardError} onRetry={onRetryDashboard}
      />
    )}

    <div className="location-grid">
      {pendingFloors.map(floorCard)}
      {doneFloors.length > 0 && (
        <details className="location-grid-done">
          <summary><StatusCheck /> {doneFloors.length} طوابق مكتملة</summary>
          <div className="location-grid">{doneFloors.map(floorCard)}</div>
        </details>
      )}
      {specialWards.map((ward) => {
        const started = startedSpecialWards.has(ward)
        return <div className="location-card special" key={ward}>
          <span className="floor-number"><WardGlyph /></span>
          <span className="location-card-body"><strong>{ward}</strong><span className="card-kind">ردهة مستقلة</span></span>
          {dashboard ? <CardStatus started={started} /> : dashboardError && <CardStatus unavailable />}
          <span className="ward-card-actions">
            <button className={started ? 'secondary-button compact' : 'primary-button compact'} onClick={() => onOpen({ floor: null, ward, mode: 'chart', slot: 'main' })}>الجارت</button>
            <button className={started ? 'secondary-button compact' : 'chart-extra-button compact'} onClick={() => onOpen({ floor: null, ward, mode: 'chart', slot: 'extra' })}>الجارت الإضافي</button>
            <button className="secondary-button compact" onClick={() => onOpen({ floor: null, ward, mode: 'pills' })}>الحبوب</button>
            <button className="secondary-button compact" onClick={() => onOpen({ floor: null, ward, mode: 'order', slot: 'main' })}>الطلبية</button>
          </span>
        </div>
      })}
    </div>

    <div className="dashboard-secondary">
      <DashboardWidgets
        topMedicines={dashboard?.topMedicines ?? []}
        medicinesPeriod={medicinesPeriod} setMedicinesPeriod={setMedicinesPeriod}
        loading={dashboardLoading} error={dashboardError} onRetry={onRetryDashboard}
        announcements={announcements} isManager={isManager}
        announcementDraft={announcementDraft} setAnnouncementDraft={setAnnouncementDraft}
        announcementError={announcementError} announcementBusy={announcementBusy}
        onPostAnnouncement={onPostAnnouncement} onEditAnnouncement={onEditAnnouncement} onDeleteAnnouncement={onDeleteAnnouncement}
      />
    </div>
  </section>
}
