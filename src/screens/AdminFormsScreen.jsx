import { useEffect, useState } from 'react'
import { apiUrl } from '../constants.js'
import { isoDate } from '../helpers.js'
import { DRUG_REQUESTS } from '../../shared/drug-requests.js'
import { readFollowup, keepFollowup, clearFollowup } from '../followupCache.js'

// متابعة الاستمارات — the request forms that need following up, hospital-wide: a Google form not sent (or sent but not
// confirmed), a form still lacking what the ministry's form or «مواقف القسم» needs, and — on a tap — patients given a first-day
// medicine with no form at all. One request when the screen opens or the period changes, the filters work on what came; the
// missing-form search runs only when asked. Nothing is polled (the Neon/Render free plans bill wake time and the data moved).
const PERIODS = [{ days: 7, label: '٧ أيام' }, { days: 14, label: '١٤ يومًا' }, { days: 31, label: 'شهر' }]
const STATES = { unsent: { text: 'لم تُرسل', tone: 'pending' }, unconfirmed: { text: 'لم يتأكد الإرسال', tone: 'pending' }, refused: { text: 'تعذّر الإرسال', tone: 'danger' }, incomplete: { text: 'ناقصة', tone: 'pending' } }
const FILTERS = [{ key: '', label: 'الكل' }, { key: 'unsent', label: 'لم تُرسل' }, { key: 'unconfirmed', label: 'لم يتأكد' }, { key: 'refused', label: 'تعذّر الإرسال' }, { key: 'incomplete', label: 'ناقصة' }]
const FIRST_DAY_KINDS = Object.entries(DRUG_REQUESTS).filter(([, spec]) => spec.firstDayOnly).map(([kind, spec]) => ({ kind, label: spec.label }))
const addDays = (iso, days) => isoDate(new Date(`${iso}T12:00:00`).getTime() + days * 86400000)
const formatDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('ar-IQ', { day: 'numeric', month: 'numeric' })
const wardText = (key) => { const [floor, ...ward] = String(key).split('|'); return floor ? `الطابق ${floor} — ${ward.join('|')}` : ward.join('|') }
const wardOf = (key) => { const [floor, ...ward] = String(key).split('|'); return { floor: floor ? Number(floor) : null, ward: ward.join('|') } }

export default function AdminFormsScreen({ adminHeader, isExpired, onOpenForm }) {
  const today = isoDate(new Date())
  const [days, setDays] = useState(7)
  const [rows, setRows] = useState(() => readFollowup(7)?.rows ?? null)
  const [more, setMore] = useState(() => readFollowup(7)?.more ?? false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(() => !readFollowup(7))
  const [reload, setReload] = useState(0)
  const [state, setState] = useState('')
  const [kind, setKind] = useState('')
  // The missing-form search: only when asked, for one kind.
  const [missingKind, setMissingKind] = useState(FIRST_DAY_KINDS[0].kind)
  const [missing, setMissing] = useState(null)
  const [missingBusy, setMissingBusy] = useState(false)
  const [missingError, setMissingError] = useState('')

  // One effect owns the fetch: a slow answer for a period already left cannot land on the one now chosen. A recent answer for the
  // period (followupCache.js) is shown as it is, without asking again; «تحديث» asks (`reload`).
  useEffect(() => {
    const kept = reload === 0 ? readFollowup(days) : null
    if (kept) { setRows(kept.rows); setMore(kept.more); setError(''); setLoading(false); return undefined }
    let cancelled = false
    setLoading(true); setError('')
    fetch(`${apiUrl}/drug-requests/followup?from=${addDays(today, 1 - days)}&to=${today}`, { credentials: 'include' })
      .then(async (response) => {
        if (isExpired(response)) return
        const result = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(result.message)
        if (!cancelled) { setRows(result.rows); setMore(result.more); keepFollowup(days, result.rows, result.more) }
      })
      .catch((caught) => { if (!cancelled) { setRows(null); setError(caught.message || 'تعذّر تحميل المتابعة — تحقّق من الاتصال وحاول مرة أخرى.') } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [days, reload, today, isExpired])

  const findMissing = async () => {
    setMissingBusy(true); setMissingError('')
    try {
      const response = await fetch(`${apiUrl}/drug-requests/missing?kind=${missingKind}&from=${addDays(today, 1 - days)}&to=${today}`, { credentials: 'include' })
      if (isExpired(response)) return
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message)
      setMissing({ kind: missingKind, days, patients: result.patients, more: result.more })
    } catch (caught) { setMissingError(caught.message || 'تعذّر البحث — تحقّق من الاتصال وحاول مرة أخرى.') } finally { setMissingBusy(false) }
  }

  const shown = (rows || []).filter((row) => (!state || row.state === state) && (!kind || row.kind === kind))
  const counts = (rows || []).reduce((sum, row) => ({ ...sum, [row.state]: (sum[row.state] || 0) + 1 }), {})

  return <main className="app-shell">{adminHeader}<section className="dashboard reports-page">
    <div className="section-heading"><div><h1>متابعة الاستمارات</h1></div></div>
    <p className="report-note">الاستمارات التي تحتاج متابعة: استمارة Google لم تُرسل أو لم يتأكد إرسالها، أو استمارة ينقصها ما يطلبه النموذج (أو «مواقف القسم» للميروبينيم). «أُرسلت» تعني أن Google قبلها أو أن الصيدلي أكّد إرسالها يدويًا؛ التطبيق لا يستطيع قراءة ردود Google نفسها.</p>
    <div className="top-medicines-periods" role="group" aria-label="المدة">
      {PERIODS.map((period) => <button key={period.days} type="button" className={period.days === days ? 'active' : ''} aria-pressed={period.days === days} onClick={() => { setDays(period.days); setMissing(null); setReload(0) }}>{period.label}</button>)}
      <button type="button" className="text-button" disabled={loading} onClick={() => { clearFollowup(); setReload((n) => n + 1) }}>تحديث</button>
    </div>
    <div className="req-chips" role="group" aria-label="النوع">
      {FILTERS.map((item) => <button key={item.key} type="button" className="req-chip" aria-pressed={state === item.key} onClick={() => setState(item.key)}>{item.label}{item.key && counts[item.key] ? ` (${counts[item.key]})` : ''}</button>)}
    </div>
    <label className="req-field forms-kind"><span className="req-label">الاستمارة</span>
      <select value={kind} onChange={(event) => setKind(event.target.value)}>
        <option value="">كل الاستمارات</option>
        {Object.entries(DRUG_REQUESTS).map(([key, spec]) => <option key={key} value={key}>{spec.label}</option>)}
      </select>
    </label>
    {error && <p className="form-error" role="alert">{error} <button type="button" className="text-button" onClick={() => { clearFollowup(); setReload((n) => n + 1) }}>إعادة المحاولة</button></p>}
    {!rows && !error ? <div className="dashboard-skeleton report-skeleton" aria-hidden="true">{Array.from({ length: 5 }, (_, i) => <span key={i} className="skeleton-row" />)}</div> : rows && (shown.length === 0
      ? <div className="empty-state"><strong>لا شيء يحتاج متابعة</strong><span>في آخر {days === 31 ? 'شهر' : `${days} يومًا`}{(state || kind) ? ' بهذه التصفية' : ''}.</span></div>
      : <div className={loading ? 'table-frame is-stale' : 'table-frame'} aria-busy={loading || undefined}><table className="requests-table report-table requests-table--stack">
        <thead><tr><th>المريض</th><th>الاستمارة</th><th>الردهة</th><th>التاريخ</th><th>الحالة</th><th /></tr></thead>
        <tbody>{shown.map((row) => <tr key={row.id}>
          <td className="requests-name">{row.name}{row.patientId && <small> · <bdi>{row.patientId}</bdi></small>}</td>
          <td data-label="الاستمارة">{DRUG_REQUESTS[row.kind].label}</td>
          <td data-label="الردهة">{wardText(row.ward)}</td>
          <td data-label="التاريخ" className="num">{formatDate(row.date)}</td>
          <td data-label="الحالة"><span className={`card-status card-status--${STATES[row.state].tone}`}>{STATES[row.state].text}</span>
            {row.problems && <small className="forms-detail">ناقصة: {row.problems.join('، ')}</small>}
            {row.error && <small className="forms-detail forms-detail--error">{row.error}</small>}
            {row.by && <small className="forms-detail">أرسلها {row.by}</small>}</td>
          <td className="requests-actions"><button type="button" className="secondary-button compact" onClick={() => onOpenForm({ ...wardOf(row.ward), kind: row.kind, date: row.date })}>فتح</button></td>
        </tr>)}</tbody>
      </table></div>)}
    {more && <p className="report-note">عُرض أول ٣٠٠ فقط — قصِّر المدة لرؤية الباقي.</p>}

    <h2 className="usage-subhead">مرضى بلا استمارة</h2>
    <p className="report-note">مرضى أُعطوا دواءً يُطلب له استمارة في أول يوم، ولا توجد لهم استمارة من نوعه قبل أول جرعة بـ٣٠ يومًا أو بعدها بـ١٤ يومًا. يُقرأ من الجارتات فقط، ولا يعمل إلا عند الضغط على «بحث».</p>
    <div className="forms-missing-controls">
      <select aria-label="نوع الاستمارة" value={missingKind} onChange={(event) => { setMissingKind(event.target.value); setMissing(null) }}>
        {FIRST_DAY_KINDS.map((item) => <option key={item.kind} value={item.kind}>{item.label}</option>)}
      </select>
      <button type="button" className="secondary-button compact" disabled={missingBusy} onClick={findMissing}>{missingBusy ? 'جارٍ البحث…' : 'بحث'}</button>
    </div>
    {missingError && <p className="form-error" role="alert">{missingError}</p>}
    {missing && missing.days === days && (missing.patients.length === 0
      ? <div className="empty-state"><strong>لا يوجد مرضى بلا استمارة</strong><span>في هذه المدة.</span></div>
      : <div className="table-frame"><table className="requests-table report-table requests-table--stack">
        <thead><tr><th>المريض</th><th>الردهة</th><th>أول جرعة</th><th /></tr></thead>
        <tbody>{missing.patients.map((row) => <tr key={`${row.ward}|${row.name}|${row.patientId}|${row.date}`}>
          <td className="requests-name">{row.name}{row.patientId && <small> · <bdi>{row.patientId}</bdi></small>}</td>
          <td data-label="الردهة">{row.floor ? `الطابق ${row.floor} — ${row.ward}` : row.ward}</td>
          <td data-label="أول جرعة" className="num">{formatDate(row.date)}</td>
          <td className="requests-actions"><button type="button" className="secondary-button compact" onClick={() => onOpenForm({ floor: row.floor, ward: row.ward, kind: missing.kind, date: row.date })}>فتح الاستمارات</button></td>
        </tr>)}</tbody>
      </table></div>)}
    {missing?.days === days && missing.more && <p className="report-note">عُرض أول ٣٠٠ فقط.</p>}
  </section></main>
}
