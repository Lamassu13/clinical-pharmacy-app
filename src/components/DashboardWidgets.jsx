import { useState } from 'react'

// The floor-picker's information layer, in two tiers.
//
// WardStatusBand is the primary one for a manager: the morning round lives or dies on "which
// wards haven't started their chart yet", so that answer gets a full-width band directly under
// the heading — a count, a track, the not-started wards named as chips, and a real all-done
// state — instead of a third of a card buried among peers.
//
// DashboardWidgets is the secondary tier everyone sees below the grid: today's top medicines
// and the manager's notices. It carries its own loading and error states so a slow or failed
// GET /api/dashboard never renders as a real "nothing happened today".
const PERIOD_LABELS = { today: 'اليوم', week: 'أسبوع', month: 'شهر' }

function DashboardError({ onRetry }) {
  return (
    <div className="dashboard-widget-notice" role="alert">
      <span>تعذّر تحميل بيانات اللوحة.</span>
      <button type="button" className="text-button" onClick={onRetry}>إعادة المحاولة</button>
    </div>
  )
}

function SkeletonRows({ count = 3 }) {
  return (
    <div className="dashboard-skeleton" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => <span key={i} className="skeleton-row" />)}
    </div>
  )
}

// How many pending wards to show inline before folding the rest. At shift start every ward is
// "not started" — that is a fresh day, not a backlog — so the band shows a handful and folds
// the rest behind a disclosure instead of a wall of amber.
const PENDING_INLINE = 8

export function WardStatusBand({ startedCount, totalCount, notStarted = [], onPickFloor, onOpen, loading, error, onRetry }) {
  if (error) {
    return <div className="ward-status-band"><DashboardError onRetry={onRetry} /></div>
  }
  if (loading) {
    return <div className="ward-status-band ward-status-band--loading"><SkeletonRows count={2} /></div>
  }

  const done = totalCount > 0 && startedCount === totalCount
  const fresh = startedCount === 0
  const startedPct = totalCount ? Math.round((startedCount / totalCount) * 100) : 0
  const inline = notStarted.slice(0, PENDING_INLINE)
  const folded = notStarted.slice(PENDING_INLINE)

  const chip = (entry) => (
    <li key={entry.label}>
      <button
        type="button"
        className="ward-status-chip"
        onClick={() => (entry.floor ? onPickFloor(entry.floor) : onOpen({ floor: null, ward: entry.ward, mode: 'chart', slot: 'main' }))}
      >{entry.label}</button>
    </li>
  )

  const cls = done ? 'ward-status-band is-done' : `ward-status-band${fresh ? ' ward-status-band--fresh' : ''}`
  return (
    <div className={cls}>
      <div className="ward-status-band-head">
        <span className="ward-status-band-label">حالة جارتات اليوم</span>
        {done ? (
          <strong className="ward-status-band-done">كل الردهات بدأت جارتها اليوم</strong>
        ) : (
          <strong className="ward-status-band-count">
            <span className="stat-good">{startedCount}</span>
            <span className="ward-status-band-of"> من {totalCount} بدأت</span>
          </strong>
        )}
      </div>
      <div className="progress-track"><div className="progress-fill" style={{ transform: `scaleX(${startedPct / 100})` }} /></div>
      {!done && notStarted.length > 0 && (
        <div className="ward-status-band-pending">
          <span className="ward-status-band-pending-label">لم تبدأ بعد</span>
          <ul>{inline.map(chip)}</ul>
          {folded.length > 0 && (
            <details className="ward-status-band-more">
              <summary>و {folded.length} غير ذلك</summary>
              <ul>{folded.map(chip)}</ul>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

export default function DashboardWidgets({
  topMedicines, medicinesPeriod, setMedicinesPeriod, loading, error, onRetry,
  announcements, isManager, announcementDraft, setAnnouncementDraft, announcementError, announcementBusy,
  onPostAnnouncement, onEditAnnouncement, onDeleteAnnouncement,
}) {
  const maxQty = topMedicines.length ? Math.max(...topMedicines.map((item) => item.quantity)) : 1
  // Which announcement is open for inline editing, plus its working text, in-flight flag, and error.
  const [editing, setEditing] = useState(null)

  return (
    <div className="dashboard-widgets">
      <details className="dashboard-widget dashboard-widget--collapsible">
        <summary className="dashboard-widget-head">
          <span className="dashboard-widget-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-45 12 12)" fill="currentColor" fillOpacity="0.14" stroke="none"></rect><rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-45 12 12)"></rect><line x1="12" y1="8.5" x2="12" y2="15.5" transform="rotate(-45 12 12)"></line></svg>
          </span>
          <strong>الأدوية الأكثر صرفًا</strong>
        </summary>
        {isManager && (
          <div className="top-medicines-periods" role="group" aria-label="مدة احتساب الأدوية">
            {['today', 'week', 'month'].map((period) => (
              <button
                key={period}
                type="button"
                className={medicinesPeriod === period ? 'active' : undefined}
                aria-pressed={medicinesPeriod === period}
                onClick={() => setMedicinesPeriod(period)}
              >{PERIOD_LABELS[period]}</button>
            ))}
          </div>
        )}
        {loading ? <SkeletonRows /> : error ? <DashboardError onRetry={onRetry} /> : topMedicines.length === 0 ? (
          <p className="dashboard-widget-empty">لا توجد كميات مسجّلة في هذه المدة.</p>
        ) : (
          <div className="top-medicines-list">
            {topMedicines.map((item) => (
              <div className="top-medicines-row" key={item.name}>
                <span className="top-medicines-name" title={item.name}>{item.name}</span>
                <div className="top-medicines-bar-track"><div className="top-medicines-bar-fill" style={{ width: `${Math.round((item.quantity / maxQty) * 100)}%` }} /></div>
                <strong className="top-medicines-qty">{item.quantity}</strong>
              </div>
            ))}
          </div>
        )}
      </details>

      <div className="dashboard-widget">
        <div className="dashboard-widget-head">
          <span className="dashboard-widget-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="2" fill="currentColor" fillOpacity="0.14" stroke="none"></rect><rect x="3.5" y="5" width="17" height="15" rx="2"></rect><circle cx="12" cy="3.25" r="1.25" fill="currentColor" stroke="none"></circle><line x1="7.5" y1="10" x2="16.5" y2="10"></line><line x1="7.5" y1="13.5" x2="16.5" y2="13.5"></line><line x1="7.5" y1="17" x2="13" y2="17"></line></svg>
          </span>
          <strong>إعلانات الإدارة</strong>
        </div>
        {loading ? <SkeletonRows /> : error ? <DashboardError onRetry={onRetry} /> : announcements.length === 0 ? (
          <p className="dashboard-widget-empty">لا توجد إعلانات حاليًا.</p>
        ) : (
          <ul className="announcement-list">
            {announcements.map((item) => (
              <li className="announcement-item" key={item.id}>
                {isManager && editing && editing.id === item.id ? (
                  <form className="announcement-compose" onSubmit={async (event) => {
                    event.preventDefault()
                    if (!editing.text.trim() || editing.busy) return
                    setEditing((cur) => cur && { ...cur, busy: true, error: '' })
                    const ok = await onEditAnnouncement(item.id, editing.text)
                    if (ok) setEditing(null)
                    else setEditing((cur) => cur && { ...cur, busy: false, error: 'تعذّر حفظ التعديل. حاول مرة أخرى.' })
                  }}>
                    <textarea
                      value={editing.text}
                      onChange={(event) => setEditing((cur) => cur && { ...cur, text: event.target.value })}
                      maxLength={500}
                      aria-label="تعديل نص الإعلان"
                    />
                    <button className="primary-button compact" type="submit" disabled={editing.busy || !editing.text.trim()}>حفظ</button>
                    <button className="text-button" type="button" onClick={() => setEditing(null)}>إلغاء</button>
                    {editing.error && <p className="form-error" role="alert">{editing.error}</p>}
                  </form>
                ) : (
                  <>
                    <p>{item.message}</p>
                    <div className="announcement-meta">
                      <span>مسؤول وحدة الصيدلة السريرية — {new Date(item.created_at).toLocaleString('ar-IQ', { dateStyle: 'short', timeStyle: 'short' })}</span>
                      {isManager && (
                        <span className="announcement-actions">
                          <button type="button" className="announcement-edit" onClick={() => setEditing({ id: item.id, text: item.message, busy: false, error: '' })}>تعديل</button>
                          <button type="button" className="announcement-del" onClick={() => onDeleteAnnouncement(item.id)}>حذف</button>
                        </span>
                      )}
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {isManager && (
          <details className="announcement-disclosure">
            <summary>إعلان جديد</summary>
            <form className="announcement-compose" onSubmit={(event) => { event.preventDefault(); onPostAnnouncement() }}>
              <textarea
                value={announcementDraft}
                onChange={(event) => setAnnouncementDraft(event.target.value)}
                placeholder="أضف إعلانًا للفريق…"
                maxLength={500}
                aria-label="نص الإعلان الجديد"
              />
              <button className="primary-button compact" type="submit" disabled={announcementBusy || !announcementDraft.trim()}>نشر</button>
            </form>
            {announcementError && <p className="form-error" role="alert">{announcementError}</p>}
          </details>
        )}
      </div>
    </div>
  )
}
