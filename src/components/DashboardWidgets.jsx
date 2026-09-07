// Information widgets shown above the floor/ward grid: today's top medicines by quantity and
// notices posted by the manager/admin, plus — for a manager only — how many wards have
// started today's chart. Only a manager can post or remove an announcement.
const PERIOD_LABELS = { today: 'اليوم', week: 'أسبوع', month: 'شهر' }

export default function DashboardWidgets({
  startedCount, totalCount, topMedicines, medicinesScope, medicinesPeriod, setMedicinesPeriod,
  announcements, isManager, announcementDraft, setAnnouncementDraft, announcementError, announcementBusy,
  onPostAnnouncement, onDeleteAnnouncement,
}) {
  const notStartedCount = totalCount - startedCount
  const startedPct = totalCount ? Math.round((startedCount / totalCount) * 100) : 0
  const maxQty = topMedicines.length ? Math.max(...topMedicines.map((item) => item.quantity)) : 1
  const medicinesSubtitle = medicinesScope === 'all'
    ? `بمجموع الكميات عبر كل الردهات — ${PERIOD_LABELS[medicinesPeriod] || 'شهر'}`
    : 'بمجموع كميات طابقك اليوم'

  return (
    <div className={isManager ? 'dashboard-widgets' : 'dashboard-widgets two-up'}>
      {isManager && (
        <div className="dashboard-widget">
          <div className="dashboard-widget-head">
            <span className="dashboard-widget-icon" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.25" fill="currentColor" fillOpacity="0.14" stroke="none"></circle><circle cx="12" cy="12" r="8.25" strokeOpacity="0.25"></circle><path d="M12 3.75A8.25 8.25 0 1 1 3.75 12"></path><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"></circle></svg>
            </span>
            <div>
              <strong>حالة الردهات اليوم</strong>
              <span>من أصل {totalCount} ردهة وطابق</span>
            </div>
          </div>
          <div className="ward-status-row">
            <strong className="stat-good">{startedCount}</strong>
            <span>بدأت جارتها</span>
            <strong className="stat-pending">{notStartedCount}</strong>
            <span>لم تبدأ بعد</span>
          </div>
          <div className="progress-track"><div className="progress-fill" style={{ width: `${startedPct}%` }} /></div>
        </div>
      )}

      <div className="dashboard-widget">
        <div className="dashboard-widget-head">
          <span className="dashboard-widget-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-45 12 12)" fill="currentColor" fillOpacity="0.14" stroke="none"></rect><rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-45 12 12)"></rect><line x1="12" y1="8.5" x2="12" y2="15.5" transform="rotate(-45 12 12)"></line></svg>
          </span>
          <div>
            <strong>الأدوية الأكثر صرفًا</strong>
            <span>{medicinesSubtitle}</span>
          </div>
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
        {topMedicines.length === 0 ? <p className="dashboard-widget-empty">لا توجد كميات مسجّلة في هذه المدة.</p> : (
          <div className="top-medicines-list">
            {topMedicines.map((item) => (
              <div className="top-medicines-row" key={item.name}>
                <span className="top-medicines-name">{item.name}</span>
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
          <div>
            <strong>إعلانات الإدارة</strong>
            <span>من المدير والمسؤولين</span>
          </div>
        </div>
        {announcements.length === 0 ? <p className="dashboard-widget-empty">لا توجد إعلانات حاليًا.</p> : (
          <ul className="announcement-list">
            {announcements.map((item) => (
              <li className="announcement-item" key={item.id}>
                <p>{item.message}</p>
                <div className="announcement-meta">
                  <span>مسؤول وحدة الصيدلة السريرية — {new Date(item.created_at).toLocaleString('ar-IQ', { dateStyle: 'short', timeStyle: 'short' })}</span>
                  {isManager && <button type="button" onClick={() => onDeleteAnnouncement(item.id)}>حذف</button>}
                </div>
              </li>
            ))}
          </ul>
        )}
        {isManager && (
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
        )}
        {announcementError && <p className="form-error" role="alert">{announcementError}</p>}
      </div>
    </div>
  )
}
