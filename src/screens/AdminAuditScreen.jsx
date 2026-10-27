import { useEffect, useState } from 'react'
import { apiUrl } from '../constants.js'

// سجل الإدارة — who did what among the consequential admin actions (accounts, roles, access,
// medicines, data purges), newest first. Admin-only and read-only; loaded when opened, older
// entries on request (no polling: the Neon/Render free plans bill wake time).
const ACTIONS = {
  'registration.approved': 'قبول طلب انضمام',
  'registration.rejected': 'رفض طلب انضمام',
  'user.role': 'تغيير دور مستخدم',
  'user.access': 'تغيير طابق/ردهة مستخدم',
  'user.deleted': 'حذف مستخدم',
  'medicine.created': 'إضافة دواء',
  'medicine.updated': 'تعديل دواء',
  'medicine.deleted': 'حذف دواء',
  'charts.purged': 'حذف جارتات',
  'pills.purged': 'حذف استمارات حبوب',
}
const formatTime = (iso) => new Date(iso).toLocaleString('ar-IQ', { dateStyle: 'medium', timeStyle: 'short' })

export default function AdminAuditScreen({ adminHeader, isExpired }) {
  const [entries, setEntries] = useState(null)
  const [more, setMore] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [request, setRequest] = useState({ before: null, nonce: 0 }) // before: id of the oldest row shown
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError('')
    fetch(`${apiUrl}/audit${request.before ? `?before=${request.before}` : ''}`, { credentials: 'include' })
      .then(async (response) => {
        if (isExpired(response)) return
        const result = await response.json()
        if (!response.ok) throw new Error(result.message)
        if (!cancelled) { setEntries((current) => (request.before && current ? [...current, ...result.entries] : result.entries)); setMore(result.more) }
      })
      .catch((caught) => { if (!cancelled) setError(caught.message || 'تعذّر تحميل السجل — تحقّق من الاتصال وحاول مرة أخرى.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [request, isExpired])

  return <main className="app-shell">{adminHeader}<section className="dashboard reports-page">
    <div className="section-heading"><div><h1>سجل الإدارة</h1></div></div>
    <p className="report-note">آخر الإجراءات الإدارية: قبول الطلبات، تغيير الأدوار والطوابق، حذف المستخدمين، تعديل الأدوية، وحذف البيانات. الأحدث أولًا، ويُحتفظ بسنة واحدة.</p>
    {error && <p className="form-error" role="alert">{error} <button type="button" className="text-button" onClick={() => setRequest((current) => ({ ...current, nonce: current.nonce + 1 }))}>إعادة المحاولة</button></p>}
    {!entries && !error ? <div className="dashboard-skeleton report-skeleton" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <span key={i} className="skeleton-row" />)}</div> : entries && (
      entries.length === 0 ? <p className="report-empty">لا توجد إجراءات مسجّلة بعد.</p> : <>
        <div className="table-frame" aria-busy={loading || undefined}><table className="requests-table report-table">
          <thead><tr><th>الإجراء</th><th>الهدف</th><th>التفاصيل</th><th>بواسطة</th><th>الوقت</th></tr></thead>
          <tbody>{entries.map((entry) => <tr key={entry.id}>
            <td>{ACTIONS[entry.action] || entry.action}</td><td><bdi>{entry.target || '—'}</bdi></td><td>{entry.detail || '—'}</td><td>{entry.actor || '—'}</td><td>{formatTime(entry.at)}</td>
          </tr>)}</tbody>
        </table></div>
        {more && <button type="button" className="secondary-button" disabled={loading} onClick={() => setRequest({ before: entries[entries.length - 1].id, nonce: 0 })}>{loading ? 'جارٍ التحميل…' : 'عرض الأقدم'}</button>}
      </>
    )}
  </section></main>
}
