import { useEffect, useState } from 'react'
import { apiUrl } from '../constants.js'

// استخدام المستخدمين — who uses the app and how much data they move, per period. Read-only; one
// request per period button press (no polling: the Neon/Render free plans bill wake time).
const PERIODS = [{ days: 7, label: '٧ أيام' }, { days: 30, label: '٣٠ يومًا' }, { days: 90, label: '٩٠ يومًا' }]
const ROLE = { admin: 'مدير', supervisor: 'مسؤول', user: 'مستخدم' }
const formatBytes = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} م.ب` : `${Math.max(bytes ? 1 : 0, Math.round(bytes / 1024))} ك.ب`)
const formatSeen = (iso) => (iso ? new Date(iso).toLocaleString('ar-IQ', { dateStyle: 'medium', timeStyle: 'short' }) : 'لم يدخل بعد')

export default function AdminUsageScreen({ adminHeader, isExpired }) {
  const [days, setDays] = useState(30)
  const [users, setUsers] = useState(null)
  const [traffic, setTraffic] = useState({ queries: [], since: null })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  // One effect owns the fetch, so a slow answer for a period the user already left can never land
  // on top of the period now selected (`cancelled`), and the old table is dimmed meanwhile.
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError('')
    fetch(`${apiUrl}/usage?days=${days}`, { credentials: 'include' })
      .then(async (response) => {
        if (isExpired(response)) return
        const result = await response.json()
        if (!response.ok) throw new Error(result.message)
        if (!cancelled) { setUsers(result.users); setTraffic({ queries: result.queries || [], since: result.queriesSince }) }
      })
      .catch((caught) => { if (!cancelled) setError(caught.message || 'تعذّر تحميل الاستخدام — تحقّق من الاتصال وحاول مرة أخرى.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [days, reload, isExpired])

  const sum = (pick) => (users || []).reduce((total, row) => total + pick(row), 0)

  return <main className="app-shell">{adminHeader}<section className="dashboard reports-page">
    <div className="section-heading"><div><h1>استخدام المستخدمين</h1></div></div>
    <p className="report-note">الأكثر استهلاكًا للبيانات أولًا. «البيانات» مجموع ما أرسله المستخدم وما استلمه من الخادم عبر التطبيق، دون ملفات التطبيق نفسها. «الحفظ» عدد عمليات الحفظ والتعديل.</p>
    <div className="top-medicines-periods" role="group" aria-label="المدة">
      {PERIODS.map((period) => <button key={period.days} type="button" className={period.days === days ? 'active' : ''} aria-pressed={period.days === days} onClick={() => setDays(period.days)}>{period.label}</button>)}
    </div>
    {error && <p className="form-error" role="alert">{error} <button type="button" className="text-button" onClick={() => setReload((n) => n + 1)}>إعادة المحاولة</button></p>}
    {!users && !error ? <div className="dashboard-skeleton report-skeleton" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <span key={i} className="skeleton-row" />)}</div> : users && (
      <div className={loading ? 'table-frame usage-table is-stale' : 'table-frame usage-table'} aria-busy={loading || undefined}><table className="requests-table report-table">
        {/* The question this screen answers is "who uses the most data", so that column sits next to the name — on a phone the rest scrolls out of view. */}
        <thead><tr><th>المستخدم</th><th>البيانات</th><th>الطلبات</th><th>الحفظ</th><th>أيام النشاط</th><th>آخر دخول</th><th>الدور</th></tr></thead>
        <tbody>{users.map((row) => <tr key={row.id}>
          <td>{row.fullName}</td><td className="num">{formatBytes(row.bytesIn + row.bytesOut)}</td><td className="num">{row.requests}</td><td className="num">{row.writes}</td>
          <td className="num">{row.activeDays}</td><td>{formatSeen(row.lastSeen)}</td><td>{ROLE[row.role] || row.role}</td>
        </tr>)}</tbody>
        <tfoot><tr>
          <th>المجموع</th><td className="num">{formatBytes(sum((row) => row.bytesIn + row.bytesOut))}</td><td className="num">{sum((row) => row.requests)}</td><td className="num">{sum((row) => row.writes)}</td><td /><td /><td />
        </tr></tfoot>
      </table></div>
    )}
    {traffic.queries.length > 0 && <>
      <h2 className="usage-subhead">أكثر الاستعلامات نقلًا للبيانات من قاعدة البيانات</h2>
      <p className="report-note">منذ آخر تشغيل للخادم ({formatSeen(traffic.since)}). الحجم تقريبي. الاستعلام الأعلى هو الأولى بالتخفيف.</p>
      <div className="table-frame"><table className="requests-table report-table">
        <thead><tr><th>الاستعلام</th><th>المرات</th><th>الصفوف</th><th>الحجم</th></tr></thead>
        <tbody>{traffic.queries.map((row) => <tr key={row.statement}>
          <td lang="en" dir="ltr">{row.statement}</td><td className="num">{row.calls}</td><td className="num">{row.rows}</td><td className="num">{formatBytes(row.bytes)}</td>
        </tr>)}</tbody>
      </table></div>
    </>}
  </section></main>
}
