import DashboardWidgets from '../components/DashboardWidgets.jsx'
import { WardGlyph, ChevronStart, StatusCheck, CardStatus } from '../components/WardGlyph.jsx'
import WardActions from '../components/WardActions.jsx'
import { wardAttention } from '../helpers.js'

// The floor/special-ward grid. `floors` / `specialWards` arrive already narrowed to what this
// user may see (their assignment, or the whole unit for a manager) — no post-paint DOM hiding.
export default function FloorPickerScreen({
  today, floors = [], specialWards = [], resumeDraft, onResume,
  onPickFloor, onOpen, dashboard, dashboardLoading, dashboardError, onRetryDashboard,
  announcements, isManager,
  announcementDraft, setAnnouncementDraft, announcementError, announcementBusy,
  onPostAnnouncement, onEditAnnouncement, onDeleteAnnouncement,
}) {
  // Count at ward granularity, not floor: a floor with one of three wards started is one
  // third done, and the two that haven't are exactly what the morning round is there to
  // catch. Shared with AdminDashboardScreen (its "لوحة التحكم" needs the same answer, via its
  // own WardStatusBand) through this one helpers.js function.
  const { floorStarted, startedSpecialWards } = wardAttention(floors, specialWards, dashboard)

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

  const nothingAssigned = !isManager && floors.length === 0 && specialWards.length === 0

  return <section className="dashboard">
    <div className="section-heading">
      <div><h1>اختر الطابق أو الردهة</h1></div>
      <div className="date-chip"><span>اليوم</span><strong>{today}</strong></div>
    </div>

    <div className="dashboard-announcements">
      <DashboardWidgets
        loading={dashboardLoading} error={dashboardError} onRetry={onRetryDashboard}
        announcements={announcements} isManager={isManager}
        announcementDraft={announcementDraft} setAnnouncementDraft={setAnnouncementDraft}
        announcementError={announcementError} announcementBusy={announcementBusy}
        onPostAnnouncement={onPostAnnouncement} onEditAnnouncement={onEditAnnouncement} onDeleteAnnouncement={onDeleteAnnouncement}
      />
    </div>

    {resumeDraft && (
      <button type="button" className="resume-draft-card" onClick={onResume}>
        <span className="resume-draft-label">لديك تعديلات لم تُحفظ</span>
        <strong>{resumeDraft.floor ? `الطابق ${resumeDraft.floor} — ${resumeDraft.ward}` : resumeDraft.ward}{resumeDraft.slot === 'extra' ? ' — إضافي' : ''} · {resumeDraft.date}</strong>
        <span className="resume-draft-go">المتابعة ←</span>
      </button>
    )}

    {nothingAssigned && (
      <div className="empty-state"><strong>لم يُسند إليك طابق أو ردهة بعد</strong><span>راجِع مسؤول وحدة الصيدلة السريرية لتعيين موقعك، ثم أعِد تسجيل الدخول.</span></div>
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
          <WardActions floor={null} ward={ward} started={started} onOpen={onOpen} />
        </div>
      })}
    </div>

  </section>
}
