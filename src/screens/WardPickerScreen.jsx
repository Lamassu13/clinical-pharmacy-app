import { useEffect, useState } from 'react'
import { apiUrl } from '../constants.js'
import { isoDate } from '../helpers.js'
import { WardGlyph, ChevronStart, CardStatus } from '../components/WardGlyph.jsx'
import { Glyph } from '../components/ToolbarIcons.jsx'
import DashboardWidgets from '../components/DashboardWidgets.jsx'
import PatientSearch from '../components/PatientSearch.jsx'
import LongAntibioticPatients from '../components/LongAntibioticPatients.jsx'
import FormsPendingNote from '../components/FormsPendingNote.jsx'

// The sub-wards of one floor. Mirrors FloorPickerScreen's header and card shape so moving
// from the floor grid into a floor doesn't feel like a different screen. The floor number
// is in the heading, so the cards don't repeat it — each carries the ward glyph instead.
export default function WardPickerScreen({
  onOpenAlbuminFollowUp, floor, today, selectedDate, isExpired, dashboard, dashboardError, onOpen, onOpenWard,
  announcements, isManager, announcementDraft, setAnnouncementDraft, announcementError, announcementBusy,
  onPostAnnouncement, onEditAnnouncement, onDeleteAnnouncement, onDeleteAllAnnouncements,
}) {
  const startedWards = new Set(
    (dashboard?.startedWards ?? [])
      .filter((item) => item.floor === floor.number)
      .map((item) => item.ward),
  )

  // Today's forms still to follow up, per ward of this floor (see FormsPendingNote). A floor user's come with the dashboard answer.
  // A manager's answer has none (and is not asked again inside a floor), so this page asks for the floor's own, each time it is
  // opened: coming back from a ward where a form was just sent shows it gone.
  const [floorPending, setFloorPending] = useState(null)
  useEffect(() => {
    if (!isManager) return undefined
    let cancelled = false
    fetch(`${apiUrl}/drug-requests/pending?${new URLSearchParams({ floor: floor.number, date: isoDate(new Date()) })}`, { credentials: 'include' })
      .then((response) => { isExpired?.(response); return response.ok ? response.json() : null })
      .then((result) => { if (!cancelled && result) setFloorPending({ floor: floor.number, ...result }) })
      .catch(() => { /* no alert rather than a wrong one */ })
    return () => { cancelled = true }
  }, [isManager, floor.number, isExpired])
  const formsPending = isManager ? (floorPending?.floor === floor.number ? floorPending : null) : dashboard?.formsPending
  const pendingByWard = new Map((formsPending?.wards ?? []).filter((item) => item.floor === floor.number).map((item) => [item.ward, item.n]))

  // The ward cards come first: they are what this page is for, and every tool below is a step aside from them. How many have
  // begun is said in words under the heading (shown once the dashboard answer is in).
  return <section className="dashboard ward-picker">
    <div className="section-heading section-heading--date">
      <div>
        <h1>الطابق {floor.number}</h1>
        {dashboard && <p className="ward-picker-sub">{startedWards.size === 0 ? 'لم تبدأ أي ردهة اليوم' : `بدأت ${startedWards.size} من ${floor.wards.length} ردهات اليوم`}</p>}
      </div>
      {today && <div className="date-chip"><Glyph icon="today" /><span>اليوم</span><strong>{today}</strong></div>}
    </div>
    <FormsPendingNote pending={formsPending} floor={floor.number} onOpenWard={onOpenWard} />
    <div className="location-grid">{floor.wards.map((ward) => {
      const started = startedWards.has(ward)
      const pending = pendingByWard.get(ward)
      return <button type="button" className="location-card location-card--link" key={ward} onClick={() => onOpenWard({ floor: floor.number, ward })}>
        <span className="floor-number"><WardGlyph /></span>
        <span className="location-card-body"><strong>{ward}</strong></span>
        {pending > 0 && <span className="card-status card-status--pending">{pending} تحتاج متابعة</span>}
        {dashboard ? <CardStatus started={started} /> : dashboardError && <CardStatus unavailable />}
        <span className="arrow"><ChevronStart /></span>
      </button>
    })}</div>
    <div className="ward-tools">
      <button type="button" className="tool-link" onClick={onOpenAlbuminFollowUp}>
        <span className="tool-link-text">متابعة الالبومين</span><span className="arrow"><ChevronStart /></span>
      </button>
      <LongAntibioticPatients date={selectedDate} floor={floor.number} isExpired={isExpired} />
      <PatientSearch floor={floor.number} date={selectedDate} onOpen={onOpen} isExpired={isExpired} />
    </div>
    {!isManager && <div className="dashboard-announcements">
      <DashboardWidgets
        loading={announcements === null} error={false}
        announcements={announcements ?? []} isManager={isManager}
        announcementDraft={announcementDraft} setAnnouncementDraft={setAnnouncementDraft}
        announcementError={announcementError} announcementBusy={announcementBusy}
        onPostAnnouncement={onPostAnnouncement} onEditAnnouncement={onEditAnnouncement} onDeleteAnnouncement={onDeleteAnnouncement} onDeleteAllAnnouncements={onDeleteAllAnnouncements}
      />
    </div>}
  </section>
}
