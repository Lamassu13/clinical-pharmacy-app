import { useState } from 'react'
import { floors } from '../constants.js'

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

// Show the whole pending list unless it's a genuine backlog; past this many, show a chunk and
// fold the rest so shift start (every ward not started) isn't a wall of amber. Mid-round there
// are rarely more than a handful pending, so the fold never triggers then.
const FOLD_THRESHOLD = 12
const FOLD_KEEP = 8

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
  const willFold = notStarted.length > FOLD_THRESHOLD
  const inline = willFold ? notStarted.slice(0, FOLD_KEEP) : notStarted
  const folded = willFold ? notStarted.slice(FOLD_KEEP) : []

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

// Shared يومي/أسبوعي/شهري control for the two analytics widgets.
function PeriodToggle({ period, setPeriod, label }) {
  return (
    <div className="top-medicines-periods" role="group" aria-label={label}>
      {['today', 'week', 'month'].map((option) => (
        <button
          key={option}
          type="button"
          className={period === option ? 'active' : undefined}
          aria-pressed={period === option}
          onClick={() => setPeriod(option)}
        >{PERIOD_LABELS[option]}</button>
      ))}
    </div>
  )
}

// The most-dispensed-medicines bar list. Collapsible on the shared landing page (non-manager);
// rendered open on إدارة الطوابق, where it is primary content.
export function TopMedicinesWidget({ topMedicines, period, setPeriod, isManager, open, loading, error, onRetry }) {
  const maxQty = topMedicines.length ? Math.max(...topMedicines.map((item) => item.quantity)) : 1
  return (
    <details className="dashboard-widget dashboard-widget--collapsible" open={open || undefined}>
      <summary className="dashboard-widget-head">
        <span className="dashboard-widget-icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-45 12 12)" fill="currentColor" fillOpacity="0.14" stroke="none"></rect><rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-45 12 12)"></rect><line x1="12" y1="8.5" x2="12" y2="15.5" transform="rotate(-45 12 12)"></line></svg>
        </span>
        <strong>الأدوية الأكثر صرفًا</strong>
      </summary>
      {isManager && <PeriodToggle period={period} setPeriod={setPeriod} label="مدة احتساب الأدوية" />}
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
  )
}

// Patients summed across every ward of a numbered floor, over this widget's own period.
export function PatientsByFloorWidget({ patientsByFloor, period, setPeriod, loading, error, onRetry }) {
  const byFloor = new Map((patientsByFloor || []).map((row) => [row.floor, row.count]))
  const rows = floors.map((item) => ({ floor: item.number, count: byFloor.get(item.number) || 0 }))
  const maxCount = Math.max(1, ...rows.map((row) => row.count))
  return (
    <div className="dashboard-widget">
      <div className="dashboard-widget-head">
        <span className="dashboard-widget-icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="7" r="3" fill="currentColor" fillOpacity="0.14" stroke="none"></circle><circle cx="9" cy="7" r="3"></circle><path d="M3.5 19c0-3 2.4-5 5.5-5s5.5 2 5.5 5"></path><path d="M16.5 5.5a2.5 2.5 0 1 1 0 5"></path><path d="M15.5 14.2c2.7.2 4.5 2.3 4.5 4.8"></path></svg>
        </span>
        <strong>عدد المرضى لكل طابق</strong>
      </div>
      <PeriodToggle period={period} setPeriod={setPeriod} label="مدة احتساب المرضى" />
      {loading ? <SkeletonRows /> : error ? <DashboardError onRetry={onRetry} /> : rows.every((row) => row.count === 0) ? (
        <p className="dashboard-widget-empty">لا يوجد مرضى مسجّلون في هذه المدة.</p>
      ) : (
        <div className="top-medicines-list">
          {rows.map((row) => (
            <div className="top-medicines-row" key={row.floor}>
              <span className="top-medicines-name">الطابق {row.floor}</span>
              <div className="top-medicines-bar-track"><div className="top-medicines-bar-fill" style={{ width: `${Math.round((row.count / maxCount) * 100)}%` }} /></div>
              <strong className="top-medicines-qty">{row.count}</strong>
            </div>
          ))}
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
  // Which announcement is open for inline editing, plus its working text, in-flight flag, and error.
  const [editing, setEditing] = useState(null)
  // Briefly confirms a saved edit — the list item looks unchanged otherwise.
  const [savedId, setSavedId] = useState(null)

  return (
    <div className={`dashboard-widgets${isManager ? ' dashboard-widgets--single' : ''}`}>
      {!isManager && (
        <TopMedicinesWidget
          topMedicines={topMedicines} period={medicinesPeriod} setPeriod={setMedicinesPeriod}
          isManager={isManager} loading={loading} error={error} onRetry={onRetry}
        />
      )}

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
                    if (ok) { setEditing(null); setSavedId(item.id); setTimeout(() => setSavedId(null), 2500) }
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
                    {savedId === item.id && <p className="form-success" role="status">تم الحفظ</p>}
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
