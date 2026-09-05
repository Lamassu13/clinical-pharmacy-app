// Three information widgets shown above the floor/ward grid: how many wards have started
// today's chart, today's top medicines by quantity across every ward, and notices posted by
// the manager/admin. All three are read by every logged-in user; only a manager can post or
// remove an announcement.
export default function DashboardWidgets({
  startedCount, totalCount, topMedicines, announcements,
  isManager, announcementDraft, setAnnouncementDraft, announcementError, announcementBusy,
  onPostAnnouncement, onDeleteAnnouncement,
}) {
  const notStartedCount = totalCount - startedCount
  const startedPct = totalCount ? Math.round((startedCount / totalCount) * 100) : 0
  const maxQty = topMedicines.length ? Math.max(...topMedicines.map((item) => item.quantity)) : 1

  return (
    <div className="dashboard-widgets">
      <div className="dashboard-widget">
        <div className="dashboard-widget-head">
          <span className="dashboard-widget-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="4" width="14" height="17" rx="2"></rect><path d="M9 3.5h6a1 1 0 0 1 1 1V6H8V4.5a1 1 0 0 1 1-1Z"></path><path d="m9 13 2 2 4-4"></path></svg>
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

      <div className="dashboard-widget">
        <div className="dashboard-widget-head">
          <span className="dashboard-widget-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"></rect><path d="M12 3v18"></path></svg>
          </span>
          <div>
            <strong>الأدوية الأكثر صرفًا اليوم</strong>
            <span>بمجموع الكميات عبر كل الردهات</span>
          </div>
        </div>
        {topMedicines.length === 0 ? <p className="dashboard-widget-empty">لا توجد كميات مسجّلة اليوم بعد.</p> : (
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
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11v2a2 2 0 0 0 2 2h1l3 5V4L6 9H5a2 2 0 0 0-2 2Z"></path><path d="M14 8a4 4 0 0 1 0 8"></path><path d="M18 5a8 8 0 0 1 0 14"></path></svg>
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
                  <span>{item.author_name || 'الإدارة'} — {new Date(item.created_at).toLocaleString('ar-IQ', { dateStyle: 'short', timeStyle: 'short' })}</span>
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
