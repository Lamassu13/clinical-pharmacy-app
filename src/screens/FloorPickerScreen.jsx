import { floors, specialWards } from '../constants.js'
import DashboardWidgets, { WardStatusBand } from '../components/DashboardWidgets.jsx'
import { WardGlyph, ChevronStart, CardStatus } from '../components/WardGlyph.jsx'

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

    <div className="location-grid">{floors.map((floor) => {
      const started = floorStarted(floor)
      return <button className="location-card location-card--link" key={floor.number} onClick={() => onPickFloor(floor)}>
        <span className="floor-number">{floor.number}</span>
        <span className="location-card-body"><strong>الطابق {floor.number}</strong><small>{floor.wards.length} أروقة فرعية</small></span>
        {dashboard && <CardStatus done={started} total={floor.wards.length} />}
        <span className="arrow"><ChevronStart /></span>
      </button>
    })}{specialWards.map((ward) => {
      const started = startedSpecialWards.has(ward)
      return <div className="location-card special" key={ward}>
        <span className="floor-number"><WardGlyph /></span>
        <span className="location-card-body"><strong>{ward}</strong><span className="card-kind">ردهة مستقلة</span></span>
        {dashboard && <CardStatus started={started} />}
        <span className="ward-card-actions">
          <button className={started ? 'secondary-button compact' : 'primary-button compact'} onClick={() => onOpen({ floor: null, ward, mode: 'chart', slot: 'main' })}>الجارت</button>
          <button className={started ? 'chart-extra-button compact is-next' : 'chart-extra-button compact'} onClick={() => onOpen({ floor: null, ward, mode: 'chart', slot: 'extra' })}>الجارت الإضافي</button>
          <button className="secondary-button compact" onClick={() => onOpen({ floor: null, ward, mode: 'pills' })}>الحبوب</button>
        </span>
      </div>
    })}</div>

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
