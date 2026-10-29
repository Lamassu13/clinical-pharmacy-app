import { useEffect, useState } from 'react'
import { apiUrl } from '../constants.js'

// الأخطاء — crashes and failed saves reported by users' devices (src/error-reporter.js), newest
// first, the last 100. Admin-only. Loaded when opened and on «تحديث» (no polling: the Neon/Render
// free plans bill wake time). «مسح الكل» deletes only the rows on screen.
const KIND = { error: 'خطأ', promise: 'وعد مرفوض', save: 'تعذّر الحفظ', load: 'تعذّر التحميل' }
const formatTime = (iso) => new Date(iso).toLocaleString('ar-IQ', { dateStyle: 'medium', timeStyle: 'short' })

export default function AdminErrorsScreen({ adminHeader, isExpired, askConfirm }) {
  const [errors, setErrors] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError('')
    fetch(`${apiUrl}/errors`, { credentials: 'include' })
      .then(async (response) => {
        if (isExpired(response)) return
        const result = await response.json()
        if (!response.ok) throw new Error(result.message)
        if (!cancelled) setErrors(result.errors)
      })
      .catch((caught) => { if (!cancelled) setError(caught.message || 'تعذّر تحميل الأخطاء — تحقّق من الاتصال وحاول مرة أخرى.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [reload, isExpired])

  const clearAll = async () => {
    if (!errors?.length) return
    const ok = await askConfirm('مسح الأخطاء المعروضة؟', { confirmLabel: 'مسح', detail: `${errors.length} خطأ` })
    if (!ok) return
    try {
      const response = await fetch(`${apiUrl}/errors`, { method: 'DELETE', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: errors.map((row) => row.id) }) })
      if (isExpired(response)) return
      if (!response.ok) throw new Error()
      setReload((n) => n + 1)
    } catch { setError('تعذّر المسح — حاول مرة أخرى.') }
  }

  return <main className="app-shell">{adminHeader}<section className="dashboard reports-page">
    <div className="section-heading"><div><h1>الأخطاء</h1></div></div>
    <p className="report-note">أخطاء حدثت على أجهزة المستخدمين: تعطّل الشاشة أو تعذّر الحفظ. آخر ١٠٠ خطأ، الأحدث أولًا. تصلك الأخطاء الجديدة على تيليغرام مجمّعة كل ٣ ساعات كحدّ أقصى.</p>
    <div className="top-medicines-periods">
      <button type="button" disabled={loading} onClick={() => setReload((n) => n + 1)}>تحديث</button>
      <button type="button" disabled={loading || !errors?.length} onClick={clearAll}>مسح الكل</button>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {!errors && !error ? <div className="dashboard-skeleton report-skeleton" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <span key={i} className="skeleton-row" />)}</div> : errors && (
      errors.length === 0 ? <p className="report-empty">لا توجد أخطاء مسجّلة.</p> : (
        <div className={loading ? 'table-frame is-stale' : 'table-frame'} aria-busy={loading || undefined}><table className="requests-table report-table">
          <thead><tr><th>الخطأ</th><th>الشاشة</th><th>المستخدم</th><th>الجهاز</th><th>النوع</th><th>الوقت</th></tr></thead>
          <tbody>{errors.map((row) => <tr key={row.id}>
            <td><bdi>{row.msg}</bdi>{row.place && <><br /><small lang="en" dir="ltr">{row.place}</small></>}</td>
            <td>{row.screen || '—'}</td><td><bdi>{row.username || '—'}</bdi></td><td>{row.device || '—'}</td><td>{KIND[row.kind] || row.kind || '—'}</td><td>{formatTime(row.at)}</td>
          </tr>)}</tbody>
        </table></div>
      )
    )}
  </section></main>
}
