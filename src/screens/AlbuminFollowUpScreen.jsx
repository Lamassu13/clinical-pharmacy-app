import { useCallback, useEffect, useRef, useState } from 'react'
import hospitalLogo from '../assets/hospital-logo.png'
import { Glyph } from '../components/ToolbarIcons.jsx'
import { apiUrl } from '../constants.js'
import { isoDate } from '../helpers.js'
import { exportReportPdf } from '../reportPdf.js'

// «Albumin follow up»: the day's albumin sheet, as the unit keeps it on paper. The main rows are the day's
// albumin forms (استمارة الالبومين, every ward the user can see) and every cell is editable here — a cell of
// one of them saves to that form, so the sheet and the form never disagree (the ward is the form's, so it
// is not editable). Rows can also be added by hand; the «Not indicated» list and the notes are typed here.
// Those are kept per day (routes/albumin-followup.js). Cells are contentEditable so what is typed is plain
// DOM text and the PDF (the reports' A4 route) draws it as it stands.
const BLANK_EXTRA = { day: '', name: '', fileNo: '', ward: '', diagnosis: '', sAlb: '', sCreat: '', vials: '', indication: '' }
const BLANK_NOT = { name: '', fileNo: '', ward: '', diagnosis: '', sAlb: '', sCreat: '', reason: '' }
const MIN_NOT_INDICATED = 3
const SAVE_DELAY = 700
const digits = (text) => text.replace(/\D/g, '')

const dateHeading = (iso) => {
  const day = new Date(`${iso}T12:00:00`)
  return `${day.toLocaleDateString('ar-IQ', { weekday: 'long' })} ${(day.getMonth() + 1).toLocaleString('ar-IQ')}/${day.getDate().toLocaleString('ar-IQ')}`
}
const indicationText = (ticks) => ticks.map((key) => `#${key.slice(1)}`).join(', ')
const ticksOf = (text) => [...new Set((text.match(/\d+/g) || []).map(Number))].filter((n) => n >= 1 && n <= 17).map((n) => `i${n}`)

// One editable cell: plain text, saved when the cursor leaves it (only if it changed); Enter ends the
// edit. Keyed by its value so a saved/reset value is drawn fresh rather than patched under the cursor.
function Cell({ value, onCommit, className, ltr, readOnly, multiline = false, label }) {
  if (readOnly) return <td className={className} dir={ltr ? 'ltr' : undefined}>{value}</td>
  const props = {
    key: value, className: `fu-edit${className ? ` ${className}` : ''}`, contentEditable: 'plaintext-only', suppressContentEditableWarning: true,
    role: 'textbox', 'aria-label': label, dir: ltr ? 'ltr' : undefined, spellCheck: false,
    onBlur: (event) => { const next = event.currentTarget.innerText.trim(); if (next !== value) onCommit(next); else event.currentTarget.textContent = value },
    onKeyDown: (event) => { if (event.key === 'Enter' && !multiline) { event.preventDefault(); event.currentTarget.blur() } },
  }
  return multiline ? <div {...props}>{value}</div> : <td {...props}>{value}</td>
}

export default function AlbuminFollowUpScreen({ adminHeader, isExpired }) {
  const today = isoDate(new Date())
  const articleRef = useRef(null)
  const [date, setDate] = useState(today)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [nonce, setNonce] = useState(0)
  const [pdfBusy, setPdfBusy] = useState(false)
  const rowsRef = useRef([])
  const saveTimer = useRef(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    fetch(`${apiUrl}/albumin-followup?date=${date}`, { credentials: 'include' })
      .then((response) => { isExpired(response); return response.ok ? response.json() : Promise.reject(new Error('load')) })
      .then((result) => { if (!cancelled) { setData(result); setLoading(false) } })
      .catch(() => { if (!cancelled) { setData(null); setError('تعذّر تحميل الصفحة — تحقّق من الاتصال وحاول مرة أخرى.'); setLoading(false) } })
    return () => { cancelled = true }
  }, [date, isExpired, nonce])
  rowsRef.current = data?.rows || []

  // A cell of a form's row: saved to the form itself (the same routes the form's screen uses).
  const saveRow = useCallback(async (id, patch) => {
    const row = rowsRef.current.find((item) => item.id === id)
    if (!row) return
    setError('')
    try {
      const response = patch.ticks
        ? await fetch(`${apiUrl}/drug-requests/${id}/ticks`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ ticks: patch.ticks }) })
        : await fetch(`${apiUrl}/drug-requests/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ name: patch.name ?? row.name, patientId: patch.patientId ?? row.patientId, fields: { ...row.fields, ...patch.fields } }) })
      if (isExpired(response)) return
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message || 'لم يُحفظ التعديل.')
      setData((current) => current && { ...current, rows: current.rows.map((item) => (item.id === id ? { ...item, name: result.request.name, patientId: result.request.patientId, fields: result.request.fields, ticks: result.request.ticks } : item)) })
    } catch (caught) {
      setError(caught.message === 'Failed to fetch' ? 'لا يوجد اتصال — التعديل يحتاج اتصالًا.' : caught.message)
      setNonce((value) => value + 1) // back to what is saved
    }
  }, [isExpired])

  // The typed parts, saved a moment after the last edit.
  const saveDoc = useCallback((doc) => {
    setData((current) => current && { ...current, doc })
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        const response = await fetch(`${apiUrl}/albumin-followup`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ date, doc }) })
        if (!isExpired(response) && !response.ok) throw new Error('save')
      } catch { setError('لم يُحفظ آخر تعديل — تحقّق من الاتصال وحاول مرة أخرى.') }
    }, SAVE_DELAY)
  }, [date, isExpired])
  useEffect(() => () => clearTimeout(saveTimer.current), [])

  const doc = data?.doc
  const setListCell = (list, blank, index, key, text) => {
    const next = [...doc[list]]
    while (next.length <= index) next.push({ ...blank })
    next[index] = { ...next[index], [key]: text }
    saveDoc({ ...doc, [list]: next })
  }
  const removeFrom = (list, index) => saveDoc({ ...doc, [list]: doc[list].filter((_, at) => at !== index) })
  const extraRows = doc?.extraRows || []
  const notRows = doc ? [...doc.notIndicated, ...Array.from({ length: Math.max(0, MIN_NOT_INDICATED - doc.notIndicated.length) }, () => ({ ...BLANK_NOT }))] : []

  const print = async () => {
    if (!articleRef.current || pdfBusy) return
    document.activeElement?.blur?.()
    setPdfBusy(true)
    try { await exportReportPdf(articleRef.current, { title: `Albumin follow up · ${date}`, name: `Albumin follow up ${date}` }) }
    catch { setError('تعذّر إنشاء ملف PDF — حاول مرة أخرى.') } finally { setPdfBusy(false) }
  }

  const empty = !loading && data && !data.rows.length && !extraRows.length
  return <main className="app-shell">{adminHeader}<section className="dashboard reports-page">
    <div className="section-heading"><div><h1>متابعة الالبومين</h1></div></div>
    <div className="reports-controls reports-controls--range">
      <label>التاريخ<input type="date" value={date} max={today} onChange={(event) => event.target.value && setDate(event.target.value)} /></label>
      <div className="reports-controls-actions">
        <button type="button" className="secondary-button" disabled={!data || loading || pdfBusy} onClick={print}><Glyph icon="print" />{pdfBusy ? 'جارٍ التحضير…' : 'طباعة / PDF'}</button>
      </div>
      <p className="reports-controls-hint">اكتب في أي خانة لتعديلها — تُحفظ فورًا. خانات الصفوف المأخوذة من الاستمارات تعدّل الاستمارة نفسها.</p>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}

    {loading && !data ? <div className="dashboard-skeleton report-skeleton" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <span key={i} className="skeleton-row" />)}</div>
      : !data ? null : (
      <article ref={articleRef} className={loading ? 'report-doc fu-sheet is-stale' : 'report-doc fu-sheet'} aria-busy={loading || undefined}>
        <header className="report-doc-head">
          <img className="hospital-logo" width="52" height="52" src={hospitalLogo} alt="" />
          <div>
            <p className="report-doc-org">مستشفى بغداد التعليمي — وحدة الصيدلة السريرية</p>
            <h2 className="report-doc-title" dir="ltr">Albumin follow up</h2>
            <p className="report-doc-range">{dateHeading(date)}</p>
          </div>
        </header>

        <section className="report-section" data-section="follow">
          {empty && <p className="report-note">لا توجد استمارات الالبومين لهذا اليوم — أضف صفًّا بيدك أو عبّئ الاستمارات من الردهات.</p>}
          <div className="table-frame"><table className="requests-table report-table fu-table">
            <thead><tr>
              <th>Treatment day</th><th>Pt. Name</th><th>File no.</th><th>Ward</th><th>Diagnosis</th><th>S.alb</th><th>S.Creat</th><th>No of vials</th><th>No of indication</th><th className="report-print-skip" />
            </tr></thead>
            <tbody>
              {data.rows.map((row) => <tr key={row.id}>
                <Cell label="Treatment day" value={row.fields.treatmentDay ? `D${row.fields.treatmentDay}` : ''} onCommit={(text) => saveRow(row.id, { fields: { treatmentDay: digits(text) } })} />
                <Cell label="Pt. Name" value={row.name} onCommit={(text) => (text ? saveRow(row.id, { name: text }) : setNonce((n) => n + 1))} />
                <Cell label="File no." value={row.patientId} ltr onCommit={(text) => saveRow(row.id, { patientId: digits(text) })} />
                <Cell label="Ward" value={row.ward} readOnly />
                <Cell label="Diagnosis" value={row.fields.diagnosis} ltr onCommit={(text) => saveRow(row.id, { fields: { diagnosis: text } })} />
                <Cell label="S.alb" value={row.fields.serumAlbumin} ltr onCommit={(text) => saveRow(row.id, { fields: { serumAlbumin: text } })} />
                <Cell label="S.Creat" value={row.fields.scr} ltr onCommit={(text) => saveRow(row.id, { fields: { scr: text } })} />
                <Cell label="No of vials" value={row.fields.count} onCommit={(text) => saveRow(row.id, { fields: { count: digits(text) } })} />
                <Cell label="No of indication" value={indicationText(row.ticks)} ltr onCommit={(text) => saveRow(row.id, { ticks: ticksOf(text) })} />
                <td className="report-print-skip" />
              </tr>)}
              {[...extraRows, { ...BLANK_EXTRA }].map((row, index) => <tr key={`extra-${index}`}>
                {['day', 'name', 'fileNo', 'ward', 'diagnosis', 'sAlb', 'sCreat', 'vials', 'indication'].map((key) => <Cell key={key} label={key} value={row[key]} ltr={['fileNo', 'diagnosis', 'sAlb', 'sCreat', 'indication'].includes(key)} onCommit={(text) => setListCell('extraRows', BLANK_EXTRA, index, key, text)} />)}
                <td className="report-print-skip">{index < extraRows.length && <button type="button" className="icon-button fu-remove" aria-label="حذف الصف" onClick={() => removeFrom('extraRows', index)}>×</button>}</td>
              </tr>)}
            </tbody>
          </table></div>
        </section>

        <section className="report-section fu-band" data-section="not-indicated">
          <div className="report-section-head"><h2 dir="ltr">Not indicated</h2></div>
          <div className="table-frame"><table className="requests-table report-table fu-table">
            <thead><tr>
              <th>No.</th><th>Pt.name</th><th>File no.</th><th>Ward</th><th>Diagnosis</th><th>S.albumin</th><th>S.creat.</th><th>Reasons</th><th className="report-print-skip" />
            </tr></thead>
            <tbody>{notRows.map((row, index) => <tr key={`not-${index}`}>
              <td>{index + 1}</td>
              {['name', 'fileNo', 'ward', 'diagnosis', 'sAlb', 'sCreat', 'reason'].map((key) => <Cell key={key} label={key} value={row[key]} ltr={['fileNo', 'diagnosis', 'sAlb', 'sCreat', 'reason'].includes(key)} onCommit={(text) => setListCell('notIndicated', BLANK_NOT, index, key, text)} />)}
              <td className="report-print-skip">{index < doc.notIndicated.length && <button type="button" className="icon-button fu-remove" aria-label="حذف الصف" onClick={() => removeFrom('notIndicated', index)}>×</button>}</td>
            </tr>)}</tbody>
          </table></div>
        </section>

        <section className="report-section" data-section="notes">
          <div className="report-section-head"><h2>ملاحظات</h2></div>
          <Cell multiline label="ملاحظات" className="fu-notes" value={doc.notes} onCommit={(text) => saveDoc({ ...doc, notes: text })} />
        </section>
      </article>
    )}
  </section></main>
}
