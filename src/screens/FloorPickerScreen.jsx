import { floors, specialWards } from '../constants.js'
import DashboardWidgets, { WardStatusBand } from '../components/DashboardWidgets.jsx'
import { WardGlyph, ChevronStart, StatusCheck } from '../components/WardGlyph.jsx'

// A manager-only marker for whether this floor/ward already has a chart today. Text, not a
// bare colour dot: "لم تبدأ" carries the meaning on its own for a screen reader and for anyone
// who can't tell the greens apart, and the amber vs muted-green treatment is a second channel.
function CardStatus({ started }) {
  return started
    ? <span className="card-status card-status--done"><StatusCheck /> بدأت</span>
    : <span className="card-status card-status--pending">لم تبدأ</span>
}

// The floor/special-ward grid. Which cards a given user may actually see is applied
// imperatively by an effect in App (it hides cards outside their assignment), so this
// renders all of them.
export default function FloorPickerScreen({
  today, onPickFloor, onOpen, dashboard, dashboardLoading, dashboardError, onRetryDashboard,
  announcements, isManager,
  medicinesPeriod, setMedicinesPeriod,
  announcementDraft, setAnnouncementDraft, announcementError, announcementBusy,
  onPostAnnouncement, onDeleteAnnouncement,
}) {
  const startedWards = dashboard?.startedWards ?? []
  const startedFloors = new Set(startedWards.filter((item) => item.floor !== null).map((item) => item.floor))
  const startedSpecialWards = new Set(startedWards.filter((item) => item.floor === null).map((item) => item.ward))
  const totalCount = floors.length + specialWards.length
  const startedCount = startedFloors.size + startedSpecialWards.size
  const notStartedNames = [
    ...floors.filter((item) => !startedFloors.has(item.number)).map((item) => `الطابق ${item.number}`),
    ...specialWards.filter((ward) => !startedSpecialWards.has(ward)),
  ]

  return <section className="dashboard">
    <div className="section-heading">
      <div><h1>اختر الطابق أو الردهة</h1></div>
      <div className="date-chip"><span>اليوم</span><strong>{today}</strong></div>
    </div>

    {isManager && (
      <WardStatusBand
        startedCount={startedCount} totalCount={totalCount} notStartedNames={notStartedNames}
        loading={dashboardLoading} error={dashboardError} onRetry={onRetryDashboard}
      />
    )}

    <div className="location-grid">{floors.map((item) => {
      const started = startedFloors.has(item.number)
      return <button className="location-card location-card--link" key={item.number} onClick={() => onPickFloor(item)}>
        <span className="floor-number">{item.number}</span>
        <span className="location-card-body"><strong>الطابق {item.number}</strong><small>{item.wards.length} أروقة فرعية</small></span>
        {isManager && <CardStatus started={started} />}
        <span className="arrow"><ChevronStart /></span>
      </button>
    })}{specialWards.map((ward) => {
      const started = startedSpecialWards.has(ward)
      return <div className="location-card special" key={ward}>
        <span className="floor-number"><WardGlyph /></span>
        <span className="location-card-body"><strong>{ward}</strong><span className="card-kind">ردهة مستقلة</span></span>
        {isManager && <CardStatus started={started} />}
        <span className="ward-card-actions"><button className="secondary-button compact" onClick={() => onOpen({ floor: null, ward, mode: 'chart', slot: 'main' })}>الجارت</button><button className="secondary-button compact" onClick={() => onOpen({ floor: null, ward, mode: 'chart', slot: 'extra' })}>الجارت الإضافي</button><button className="primary-button compact" onClick={() => onOpen({ floor: null, ward, mode: 'pills' })}>الحبوب</button></span>
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
        onPostAnnouncement={onPostAnnouncement} onDeleteAnnouncement={onDeleteAnnouncement}
      />
    </div>
  </section>
}
