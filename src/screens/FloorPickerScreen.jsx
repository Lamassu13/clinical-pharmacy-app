import { floors, specialWards } from '../constants.js'
import DashboardWidgets from '../components/DashboardWidgets.jsx'

// The floor/special-ward grid. Which cards a given user may actually see is applied
// imperatively by an effect in App (it hides cards outside their assignment), so this
// renders all of them.
export default function FloorPickerScreen({
  today, onPickFloor, onOpen, dashboard, announcements, isManager,
  announcementDraft, setAnnouncementDraft, announcementError, announcementBusy,
  onPostAnnouncement, onDeleteAnnouncement,
}) {
  const startedWards = dashboard?.startedWards ?? []
  const startedFloors = new Set(startedWards.filter((item) => item.floor !== null).map((item) => item.floor))
  const startedSpecialWards = new Set(startedWards.filter((item) => item.floor === null).map((item) => item.ward))
  const totalCount = floors.length + specialWards.length
  const startedCount = startedFloors.size + startedSpecialWards.size

  return <section className="dashboard"><div className="section-heading"><div><p className="eyebrow">مساحة العمل اليومية</p><h1>اختر الطابق أو الردهة</h1><p>ابدأ باختيار موقع الجارت الذي تريد تسجيله أو مراجعته.</p></div><div className="date-chip"><span>اليوم</span><strong>{today}</strong></div></div>

    <DashboardWidgets
      startedCount={startedCount} totalCount={totalCount} topMedicines={dashboard?.topMedicines ?? []}
      announcements={announcements} isManager={isManager}
      announcementDraft={announcementDraft} setAnnouncementDraft={setAnnouncementDraft}
      announcementError={announcementError} announcementBusy={announcementBusy}
      onPostAnnouncement={onPostAnnouncement} onDeleteAnnouncement={onDeleteAnnouncement}
    />

    <div className="location-grid">{floors.map((item) => {
      const started = startedFloors.has(item.number)
      return <button className="location-card" key={item.number} onClick={() => onPickFloor(item)}>
        <span className={started ? 'location-status-dot' : 'location-status-dot not-started'} aria-hidden="true" />
        <span className="sr-only">{started ? 'بدأت جارتها اليوم' : 'لم تبدأ بعد'}</span>
        <span className="floor-number">{item.number}</span>
        <span><strong>الطابق {item.number}</strong><small>{item.wards.length} أروقة فرعية</small></span>
        <span className="arrow">←</span>
      </button>
    })}{specialWards.map((ward) => {
      const started = startedSpecialWards.has(ward)
      return <div className="location-card special" key={ward}>
        <span className={started ? 'location-status-dot' : 'location-status-dot not-started'} aria-hidden="true" />
        <span className="sr-only">{started ? 'بدأت جارتها اليوم' : 'لم تبدأ بعد'}</span>
        <span className="floor-number">✚</span>
        <span><strong>{ward}</strong></span>
        <span className="ward-card-actions"><button className="secondary-button compact" onClick={() => onOpen({ floor: null, ward, mode: 'chart' })}>الجارت</button><button className="primary-button compact" onClick={() => onOpen({ floor: null, ward, mode: 'pills' })}>الحبوب</button></span>
      </div>
    })}</div>
  </section>
}
