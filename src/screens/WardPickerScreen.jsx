import { WardGlyph, ChevronStart, CardStatus } from '../components/WardGlyph.jsx'
import DashboardWidgets from '../components/DashboardWidgets.jsx'
import PatientSearch from '../components/PatientSearch.jsx'
import LongAntibioticPatients from '../components/LongAntibioticPatients.jsx'

// The sub-wards of one floor. Mirrors FloorPickerScreen's header and card shape so moving
// from the floor grid into a floor doesn't feel like a different screen. The floor number
// is in the heading, so the cards don't repeat it — each carries the ward glyph instead.
export default function WardPickerScreen({
  onOpenAlbuminFollowUp, floor, today, selectedDate, isExpired, dashboard, dashboardError, onBack, onOpen, onOpenWard,
  announcements, isManager, announcementDraft, setAnnouncementDraft, announcementError, announcementBusy,
  onPostAnnouncement, onEditAnnouncement, onDeleteAnnouncement,
}) {
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
        {today && <div className="date-chip"><span>اليوم</span><strong>{today}</strong></div>}
      </div>
    </div>
    <button type="button" className="secondary-button albumin-follow-link" onClick={onOpenAlbuminFollowUp}>متابعة الالبومين</button>
    <LongAntibioticPatients date={selectedDate} floor={floor.number} isExpired={isExpired} />
    <PatientSearch floor={floor.number} date={selectedDate} onOpen={onOpen} isExpired={isExpired} />
    <div className="location-grid">{floor.wards.map((ward) => {
      const started = startedWards.has(ward)
      return <button type="button" className="location-card location-card--link" key={ward} onClick={() => onOpenWard({ floor: floor.number, ward })}>
        <span className="floor-number"><WardGlyph /></span>
        <span className="location-card-body"><strong>{ward}</strong></span>
        {dashboard ? <CardStatus started={started} /> : dashboardError && <CardStatus unavailable />}
        <span className="arrow"><ChevronStart /></span>
      </button>
    })}</div>
    {!isManager && <div className="dashboard-announcements">
      <DashboardWidgets
        loading={announcements === null} error={false}
        announcements={announcements ?? []} isManager={isManager}
        announcementDraft={announcementDraft} setAnnouncementDraft={setAnnouncementDraft}
        announcementError={announcementError} announcementBusy={announcementBusy}
        onPostAnnouncement={onPostAnnouncement} onEditAnnouncement={onEditAnnouncement} onDeleteAnnouncement={onDeleteAnnouncement}
      />
    </div>}
  </section>
}
