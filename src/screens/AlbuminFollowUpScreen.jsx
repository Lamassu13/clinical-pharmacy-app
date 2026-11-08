import { useCallback, useEffect, useRef, useState } from 'react'
import hospitalLogo from '../assets/hospital-logo.png'
import { Glyph } from '../components/ToolbarIcons.jsx'
import { apiUrl } from '../constants.js'
import { isoDate } from '../helpers.js'
import { exportReportPdf } from '../reportPdf.js'

// «Albumin follow up»: one floor's albumin sheet for the day, as the unit keeps it on paper. The main rows
// are the day's albumin forms (استمارة الالبومين) of this floor's wards and every cell is editable here — a
// cell of one of them saves to that form, so the sheet and the form never disagree (the ward is the
// form's, so it is not editable). Rows can also be added by hand; the «Not indicated» list and the notes
// are typed here and kept per day and floor (routes/albumin-followup.js). The tables read left to right
// like the paper sheet; on a phone the same table slides sideways with the name column pinned. Cells are contentEditable so what is typed is
// plain DOM text and the PDF (the reports' A4 route) draws it as it stands.
const MAIN_COLUMNS = [['day', 'Treatment day'], ['name', 'Pt. Name'], ['fileNo', 'File no.'], ['ward', 'Ward'], ['diagnosis', 'Diagnosis'], ['sAlb', 'S.alb'], ['sCreat', 'S.Creat'], ['vials', 'No of vials'], ['indication', 'No of indication']]
const NOT_COLUMNS = [['name', 'Pt.name'], ['fileNo', 'File no.'], ['ward', 'Ward'], ['diagnosis', 'Diagnosis'], ['sAlb', 'S.albumin'], ['sCreat', 'S.creat.'], ['reason', 'Reasons']]
const NUMBER_KEYS = ['fileNo', 'sAlb', 'sCreat', 'indication', 'day', 'vials'] // always left-to-right
const BLANK_EXTRA = Object.fromEntries(MAIN_COLUMNS.map(([key]) => [key, '']))
const BLANK_NOT = Object.fromEntries(NOT_COLUMNS.map(([key]) => [key, '']))
const MIN_NOT_INDICATED = 3
const SAVE_DELAY = 700
const digits = (text) => text.replace(/\D/g, '')

const dateHeading = (iso) => {
  const day = new Date(`${iso}T12:00:00`)
  return `${day.toLocaleDateString('ar-IQ', { weekday: 'long' })} ${(day.getMonth() + 1).toLocaleString('ar-IQ')}/${day.getDate().toLocaleString('ar-IQ')}`
}
const indicationText = (ticks) => ticks.map((key) => `#${key.slice(1)}`).join(', ')
const ticksOf = (text) => [...new Set((text.match(/\d+/g) || []).map(Number))].filter((n) => n >= 1 && n <= 17).map((n) => `i${n}`)

// One editable cell: plain text in a box inside the cell, saved when the cursor leaves it (only if it
// changed); Enter ends the edit. Keyed by its value so a saved/reset value is drawn fresh rather than
// patched under the cursor. `label` names it for screen readers and, on a phone, heads its line on the card.
function Cell({ value, onCommit, className, ltr, readOnly, multiline = false, label }) {
  const direction = ltr ? 'ltr' : 'auto'
  if (multiline) return <EditBox value={value} onCommit={onCommit} className={className} direction={direction} label={label} multiline />
  return <td className={className} data-label={label}>{readOnly
    ? <span className="fu-edit fu-edit--fixed" dir={direction}>{value}</span>
    : <EditBox value={value} onCommit={onCommit} direction={direction} label={label} />}</td>
}
function EditBox({ value, onCommit, className, direction, label, multiline }) {
  return <div key={value} className={`fu-edit${className ? ` ${className}` : ''}`} contentEditable="plaintext-only" suppressContentEditableWarning role="textbox" aria-label={label} aria-multiline={multiline || undefined} dir={direction} spellCheck={false}
    onBlur={(event) => { const next = event.currentTarget.innerText.trim(); if (next !== value) onCommit(next); else event.currentTarget.textContent = value }}
    onKeyDown={(event) => { if (event.key === 'Enter' && !multiline) { event.preventDefault(); event.currentTarget.blur() } }}>{value}</div>
}

// The sheet itself (title, the two tables, the notes) — what is on screen and what the PDF draws. Shown by
// the screen below; given plain data and handlers so it can be rendered on its own.
export function FollowUpSheet({ sheetRef, stale, date, floor, data, saveRow, setListCell, saveDoc, setNonce }) {
  const { doc } = data
  const extraRows = doc.extraRows
  const notRows = [...doc.notIndicated, ...Array.from({ length: Math.max(0, MIN_NOT_INDICATED - doc.notIndicated.length) }, () => ({ ...BLANK_NOT }))]
  const empty = !data.rows.length && !extraRows.length
  return <article ref={sheetRef} className={stale ? 'report-doc fu-sheet is-stale' : 'report-doc fu-sheet'} aria-busy={stale || undefined}>
    <header className="report-doc-head">
      <img className="hospital-logo" width="52" height="52" src={hospitalLogo} alt="" />
      <div>
        <p className="report-doc-org">مستشفى بغداد التعليمي — وحدة الصيدلة السريرية</p>
        <h2 className="report-doc-title" dir="ltr">Albumin follow up</h2>
        <p className="report-doc-range">{dateHeading(date)} — الطابق {floor}</p>
      </div>
    </header>

    <section className="report-section" data-section="follow">
      {empty && <p className="report-note">لا توجد استمارات الالبومين لهذا الطابق في هذا اليوم — أضف صفًّا بيدك أو عبّئ الاستمارات من الردهات.</p>}
      <div className="table-frame fu-frame"><table className="requests-table report-table fu-table" dir="ltr">
        <thead><tr>{MAIN_COLUMNS.map(([key, header]) => <th key={key} scope="col">{header}</th>)}</tr></thead>
        <tbody>
          {data.rows.map((row) => <tr key={row.id}>
            <Cell label="Treatment day" ltr value={row.fields.treatmentDay ? `D${row.fields.treatmentDay}` : ''} onCommit={(text) => saveRow(row.id, { fields: { treatmentDay: digits(text) } })} />
            <Cell label="Pt. Name" value={row.name} onCommit={(text) => (text ? saveRow(row.id, { name: text }) : setNonce((n) => n + 1))} />
            <Cell label="File no." ltr value={row.patientId} onCommit={(text) => saveRow(row.id, { patientId: digits(text) })} />
            <Cell label="Ward" value={row.ward} readOnly />
            <Cell label="Diagnosis" value={row.fields.diagnosis} onCommit={(text) => saveRow(row.id, { fields: { diagnosis: text } })} />
            <Cell label="S.alb" ltr value={row.fields.serumAlbumin} onCommit={(text) => saveRow(row.id, { fields: { serumAlbumin: text } })} />
            <Cell label="S.Creat" ltr value={row.fields.scr} onCommit={(text) => saveRow(row.id, { fields: { scr: text } })} />
            <Cell label="No of vials" ltr value={row.fields.count} onCommit={(text) => saveRow(row.id, { fields: { count: digits(text) } })} />
            <Cell label="No of indication" ltr value={indicationText(row.ticks)} onCommit={(text) => saveRow(row.id, { ticks: ticksOf(text) })} />
          </tr>)}
          {[...extraRows, { ...BLANK_EXTRA }].map((row, index) => <tr key={`extra-${index}`} className={index === extraRows.length ? 'fu-new-row' : undefined}>
            {MAIN_COLUMNS.map(([key, label]) => <Cell key={key} label={label} value={row[key]} ltr={NUMBER_KEYS.includes(key)} onCommit={(text) => setListCell('extraRows', BLANK_EXTRA, index, key, text)} />)}
          </tr>)}
        </tbody>
      </table></div>
    </section>

    <section className="report-section fu-band" data-section="not-indicated">
      <div className="report-section-head"><h2 dir="ltr">Not indicated</h2></div>
      <div className="table-frame fu-frame"><table className="requests-table report-table fu-table" dir="ltr">
        <thead><tr><th scope="col">No.</th>{NOT_COLUMNS.map(([key, header]) => <th key={key} scope="col">{header}</th>)}</tr></thead>
        <tbody>{notRows.map((row, index) => <tr key={`not-${index}`}>
          <td data-label="No.">{index + 1}</td>
          {NOT_COLUMNS.map(([key, label]) => <Cell key={key} label={label} value={row[key]} ltr={NUMBER_KEYS.includes(key)} onCommit={(text) => setListCell('notIndicated', BLANK_NOT, index, key, text)} />)}
        </tr>)}</tbody>
      </table></div>
    </section>

    <section className="report-section" data-section="notes">
      <div className="report-section-head"><h2>ملاحظات</h2></div>
      <Cell multiline label="ملاحظات" className="fu-notes" value={doc.notes} onCommit={(text) => saveDoc({ ...doc, notes: text })} />
    </section>
  </article>
}

export default function AlbuminFollowUpScreen({ adminHeader, isExpired, floor, onBack }) {
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
    fetch(`${apiUrl}/albumin-followup?${new URLSearchParams({ date, floor })}`, { credentials: 'include' })
      .then((response) => { isExpired(response); return response.ok ? response.json() : Promise.reject(new Error('load')) })
      .then((result) => { if (!cancelled) { setData(result); setLoading(false) } })
      .catch(() => { if (!cancelled) { setData(null); setError('تعذّر تحميل الصفحة — تحقّق من الاتصال وحاول مرة أخرى.'); setLoading(false) } })
    return () => { cancelled = true }
  }, [date, floor, isExpired, nonce])
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
        const response = await fetch(`${apiUrl}/albumin-followup`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ date, floor, doc }) })
        if (!isExpired(response) && !response.ok) throw new Error('save')
      } catch { setError('لم يُحفظ آخر تعديل — تحقّق من الاتصال وحاول مرة أخرى.') }
    }, SAVE_DELAY)
  }, [date, floor, isExpired])
  useEffect(() => () => clearTimeout(saveTimer.current), [])

  const setListCell = (list, blank, index, key, text) => {
    const next = [...data.doc[list]]
    while (next.length <= index) next.push({ ...blank })
    next[index] = { ...next[index], [key]: text }
    saveDoc({ ...data.doc, [list]: next })
  }

  const print = async () => {
    if (!articleRef.current || pdfBusy) return
    document.activeElement?.blur?.()
    setPdfBusy(true)
    try { await exportReportPdf(articleRef.current, { title: `Albumin follow up · الطابق ${floor} · ${date}`, name: `Albumin follow up F${floor} ${date}` }) }
    catch { setError('تعذّر إنشاء ملف PDF — حاول مرة أخرى.') } finally { setPdfBusy(false) }
  }

  return <main className="app-shell">{adminHeader}<section className="dashboard reports-page fu-page">
    <button type="button" className="back-button" onClick={onBack}>→ العودة للردهات</button>
    <div className="section-heading"><div><h1>متابعة الالبومين — الطابق {floor}</h1></div></div>
    <div className="reports-controls reports-controls--range fu-controls">
      <label>التاريخ<input type="date" value={date} max={today} onChange={(event) => event.target.value && setDate(event.target.value)} /></label>
      <div className="reports-controls-actions">
        <button type="button" className="secondary-button" disabled={!data || loading || pdfBusy} onClick={print}><Glyph icon="print" />{pdfBusy ? 'جارٍ التحضير…' : 'طباعة / PDF'}</button>
      </div>
      <p className="reports-controls-hint">اكتب في أي خانة لتعديلها — تُحفظ فورًا. خانات الصفوف المأخوذة من الاستمارات تعدّل الاستمارة نفسها.</p>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}

    {loading && !data ? <div className="dashboard-skeleton report-skeleton" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <span key={i} className="skeleton-row" />)}</div>
      : !data ? null : <FollowUpSheet sheetRef={articleRef} stale={loading} date={date} floor={floor} data={data} saveRow={saveRow} setListCell={setListCell} saveDoc={saveDoc} setNonce={setNonce} />}
  </section></main>
}
