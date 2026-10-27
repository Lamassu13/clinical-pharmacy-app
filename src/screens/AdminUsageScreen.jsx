import { useCallback, useEffect, useState } from 'react'
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
  const [error, setError] = useState('')
  const load = useCallback(async (period) => {
    setError('')
    try {
      const response = await fetch(`${apiUrl}/usage?days=${period}`, { credentials: 'include' })
      if (isExpired(response)) return
      const result = await response.json()
      if (!response.ok) throw new Error(result.message)
      setUsers(result.users)
    } catch (caught) { setError(caught.message || 'تعذّر تحميل الاستخدام — تحقّق من الاتصال وحاول مرة أخرى.') }
  }, [isExpired])
  useEffect(() => { load(days) }, [days, load])

  return <main className="app-shell">{adminHeader}<section className="dashboard reports-page">
    <div className="section-heading"><div><h1>استخدام المستخدمين</h1></div></div>
    <p className="report-note">الأكثر استهلاكًا للبيانات أولًا. «البيانات» مجموع ما أرسله المستخدم وما استلمه من الخادم عبر التطبيق، دون ملفات التطبيق نفسها. «الحفظ» عدد عمليات الحفظ والتعديل.</p>
    <div className="top-medicines-periods" role="group" aria-label="المدة">
      {PERIODS.map((period) => <button key={period.days} type="button" className={period.days === days ? 'active' : ''} aria-pressed={period.days === days} onClick={() => setDays(period.days)}>{period.label}</button>)}
    </div>
    {error && <p className="form-error" role="alert">{error} <button type="button" className="text-button" onClick={() => load(days)}>إعادة المحاولة</button></p>}
    {!users && !error ? <div className="dashboard-skeleton report-skeleton" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <span key={i} className="skeleton-row" />)}</div> : users && (
      <div className="table-frame"><table className="requests-table report-table">
        <thead><tr><th>المستخدم</th><th>الدور</th><th>آخر دخول</th><th>أيام النشاط</th><th>الطلبات</th><th>الحفظ</th><th>البيانات</th></tr></thead>
        <tbody>{users.map((row) => <tr key={row.id}>
          <td>{row.fullName}</td><td>{ROLE[row.role] || row.role}</td><td>{formatSeen(row.lastSeen)}</td>
          <td className="num">{row.activeDays}</td><td className="num">{row.requests}</td><td className="num">{row.writes}</td><td className="num">{formatBytes(row.bytesIn + row.bytesOut)}</td>
        </tr>)}</tbody>
      </table></div>
    )}
  </section></main>
}
