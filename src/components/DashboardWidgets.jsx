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

export function WardStatusBand({ startedCount, totalCount, notStartedNames = [], loading, error, onRetry }) {
  if (error) {
    return <div className="ward-status-band"><DashboardError onRetry={onRetry} /></div>
  }
  if (loading) {
    return <div className="ward-status-band ward-status-band--loading"><SkeletonRows count={2} /></div>
  }

  const done = totalCount > 0 && startedCount === totalCount
  const startedPct = totalCount ? Math.round((startedCount / totalCount) * 100) : 0

  return (
    <div className={done ? 'ward-status-band is-done' : 'ward-status-band'}>
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
      <div className="progress-track"><div className="progress-fill" style={{ width: `${startedPct}%` }} /></div>
      {!done && notStartedNames.length > 0 && (
        <div className="ward-status-band-pending">
          <span className="ward-status-band-pending-label">لم تبدأ بعد</span>
          <ul>{notStartedNames.map((name) => <li key={name}>{name}</li>)}</ul>
        </div>
      )}
    </div>
  )
}

export default function DashboardWidgets({
  topMedicines, medicinesPeriod, setMedicinesPeriod, loading, error, onRetry,
  announcements, isManager, announcementDraft, setAnnouncementDraft, announcementError, announcementBusy,
  onPostAnnouncement, onDeleteAnnouncement,
}) {
  const maxQty = topMedicines.length ? Math.max(...topMedicines.map((item) => item.quantity)) : 1

  return (
    <div className="dashboard-widgets">
      <div className="dashboard-widget">
        <div className="dashboard-widget-head">
          <span className="dashboard-widget-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-45 12 12)" fill="currentColor" fillOpacity="0.14" stroke="none"></rect><rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-45 12 12)"></rect><line x1="12" y1="8.5" x2="12" y2="15.5" transform="rotate(-45 12 12)"></line></svg>
          </span>
          <strong>الأدوية الأكثر صرفًا</strong>
        </div>
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
      </div>

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
                <p>{item.message}</p>
                <div className="announcement-meta">
                  <span>مسؤول وحدة الصيدلة السريرية — {new Date(item.created_at).toLocaleString('ar-IQ', { dateStyle: 'short', timeStyle: 'short' })}</span>
                  {isManager && <button type="button" className="announcement-del" onClick={() => onDeleteAnnouncement(item.id)}>حذف</button>}
                </div>
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
