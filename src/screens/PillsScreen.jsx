import { useState } from 'react'
import hospitalLogo from '../assets/hospital-logo.png'
import PillSelect from '../components/PillSelect.jsx'
import { usageMethods, noteOptions, doseTimeGroups } from '../constants.js'
import { pillSheetPlan, scheduleFor } from '../helpers.js'

// Spare rows per patient for a medicine the chart doesn't carry — the ruled hand-write rows the
// form always had — with a screen-only button to add more on demand. Editable on screen (kept as
// pill_entries under these synthetic keys, same as a real medicine row) and printed blank when
// unused. How many show, and on which sheet, is pillSheetPlan's call (helpers.js).
const EXTRA_ROW_SCAN = 20
const extraRowsFor = (count) => Array.from({ length: count }, (_, i) => ({ key: `extra-row-${i + 1}`, label: `سطر إضافي ${(i + 1).toLocaleString('ar-IQ')}` }))
const hasEntryData = (entry) => Boolean(entry && (entry.pillName || entry.pillQty || entry.doseTime || entry.usageMethod || entry.note))
const hasSchedule = (entry) => Boolean(entry && (entry.doseTime || entry.usageMethod || entry.note))
const BLANK_ENTRY = { doseTime: '', usageMethod: '', note: '', pillQty: null, pillName: '' }

export default function PillsScreen({
  header, wardLabel, roomLabel, today, editTime, onBack,
  selectedDate, onChangeDate, pillsLoading, pillsData, pillsSaveStatus, pillsLoadError,
  pillEntries, setPillEntries, pillRooms, setPillRooms, pillSelection, onTogglePatient, onSetPillSelection, pillsYesterday, isOnline,
  printScope, lastPrintingRow, onPrint, confirmModal, pillsClashNote, onDismissPillsClashNote,
}) {
  // How many extra rows a patient's form shows beyond the default two: the higher of (a) this
  // tab's own click count, ephemeral and reset on reload, and (b) however far a *saved* extra
  // row actually reaches — reading pillEntries directly rather than trusting local state alone
  // is what keeps a typed 3rd/4th row from silently disappearing behind the "+" button on the
  // next visit just because nobody clicked it again yet.
  const [extraRowCounts, setExtraRowCounts] = useState({})
  const filledExtraReach = (rowNumber) => {
    let reach = 0
    for (let i = 1; i <= EXTRA_ROW_SCAN; i += 1) if (hasEntryData(pillEntries[`${rowNumber}:extra-row-${i}`])) reach = i
    return reach
  }
  // Offline is not a failure: every edit is already kept on this device (the pills draft) and
  // goes up by itself when the signal returns — so say that, in amber, not a red «لم يُحفظ».
  const offlineHeld = !isOnline && !pillsLoadError && pillsSaveStatus !== 'saved'
  const saveErrored = pillsLoadError || (pillsSaveStatus === 'error' && !offlineHeld)
  const saveText = pillsLoadError ? '⚠ تعذّر تحميل الاستمارة — إعادة المحاولة…'
    : offlineHeld ? '○ محفوظ على الجهاز — سيُرسل عند عودة الاتصال'
    : pillsSaveStatus === 'error' ? '⚠ لم يُحفظ — تُعاد المحاولة…'
    : pillsSaveStatus === 'saving' ? '⟳ جارٍ الحفظ…'
    : pillsSaveStatus === 'pending' ? '○ لم يُحفظ بعد…'
    : '● محفوظ تلقائيًا'
  const saveClass = saveErrored ? 'save-state save-state-error'
    : pillsSaveStatus === 'saving' ? 'save-state save-state-saving'
    : pillsSaveStatus === 'pending' || offlineHeld ? 'save-state save-state-pending'
    : 'save-state'

  const patientsOnForm = pillsData?.patients ?? []
  // One patient's medicine rows, as {key, entry}, for the two bulk fills below.
  const medRowsOf = (patient) => pillsData.medicines
    .filter((med) => (pillsData.matrix[patient.rowNumber] || []).includes(med.key))
    .map((med) => ({ medKey: med.key, key: `${patient.rowNumber}:${med.key}`, entry: pillEntries[`${patient.rowNumber}:${med.key}`] || BLANK_ENTRY }))
  // Both only ever fill a row whose schedule is still empty — never overwrite a choice made today.
  const fillEmptyRows = (rows, scheduleOf) => setPillEntries((current) => {
    const next = { ...current }
    rows.forEach(({ key, medKey }) => {
      const entry = next[key] || BLANK_ENTRY
      const source = scheduleOf(medKey)
      if (hasSchedule(entry) || !hasSchedule(source)) return
      next[key] = { ...entry, doseTime: source.doseTime, usageMethod: source.usageMethod, note: source.note }
    })
    return next
  })

  const selectedNames = pillsData
    ? pillsData.patients.filter((patient) => pillSelection.has(patient.rowNumber)).map((patient) => patient.name)
    : []

  return <main className="app-shell">
    {header}

    <section className="pills-page">
      <div className="chart-toolbar pills-toolbar">
        <button className="back-button" onClick={onBack}>→ العودة للردهات</button>
        <div><p className="modal-kicker">استمارة إعطاء الحبوب</p><h1>{wardLabel}</h1></div>
        <div className="toolbar-actions">
          <label className="pills-date">التاريخ <input type="date" value={selectedDate} onChange={(event) => onChangeDate(event.target.value)} /></label>
          <span className={saveClass} role={saveErrored ? 'alert' : undefined} aria-live={saveErrored ? undefined : 'polite'}>{saveText}</span>
          <button className="primary-button compact" disabled={!patientsOnForm.length} onClick={() => onPrint('all')}>طباعة الكل</button>
          <button className="secondary-button compact" disabled={pillSelection.size === 0} onClick={() => onPrint('selected')}>طباعة المحدّدين ({pillSelection.size})</button>
        </div>
      </div>

      {/* Same warning-tinted banner chart uses for a recovered offline draft (.chart-clash-note) —
          reused as-is rather than duplicated, since it's plain "review this" styling, not
          chart-specific. */}
      {pillsClashNote && <div className="chart-clash-note" role="status">
        <span>{pillsClashNote}</span>
        <button type="button" className="text-button compact" aria-label="إخفاء" onClick={onDismissPillsClashNote}>حسنًا</button>
      </div>}

      {patientsOnForm.length > 0 && <div className={`pills-pick-note${pillSelection.size ? ' pills-pick-note-active' : ''}`}>
        {pillSelection.size === 0
          ? <span>للطباعة المحدّدة، أشّر «تحديد للطباعة» في بطاقة كل مريض مطلوب.</span>
          : <span><strong>المحدَّدون للطباعة ({pillSelection.size}):</strong> {selectedNames.join('، ')}</span>}
        <span className="pills-pick-actions">
          {pillSelection.size < patientsOnForm.length && <button type="button" className="text-button compact" onClick={() => onSetPillSelection(new Set(patientsOnForm.map((patient) => patient.rowNumber)))}>تحديد الكل</button>}
          {pillSelection.size > 0 && <button type="button" className="text-button compact" onClick={() => onSetPillSelection(new Set())}>إلغاء التحديد</button>}
        </span>
      </div>}

      {pillsLoading ? <div className="empty-state"><span className="spinner" /><span>جارٍ تحميل الاستمارة…</span></div>
        : !pillsData ? <div className="empty-state"><strong>لا يوجد جارت لهذا اليوم</strong><span>سجّل جارت هذه الردهة أولًا، ثم ستُبنى استمارة الحبوب تلقائيًا.</span></div>
        : pillsData.patients.length === 0 ? <div className="empty-state"><strong>لا حبوب لعرضها</strong><span>لا يوجد مريض لديه علاج أقراص أو كبسولات (Tab / Cap) في جارت هذا اليوم.</span></div>
        : pillsData.patients.flatMap((patient) => {
          const unpicked = pillSelection.size > 0 && !pillSelection.has(patient.rowNumber)
          const willPrint = printScope === 'all' || pillSelection.has(patient.rowNumber)
          const patientMeds = pillsData.medicines.filter((med) => (pillsData.matrix[patient.rowNumber] || []).includes(med.key))
          // Sheets of 7 rows, spare rows included — see pillSheetPlan. Every sheet carries the
          // same header; the spare rows and the signature ride on the last one.
          const { pages, extraCount } = pillSheetPlan(patientMeds, { filledExtraReach: filledExtraReach(patient.rowNumber), requestedExtras: extraRowCounts[patient.rowNumber] || 0 })
          const medRows = medRowsOf(patient)
          const firstFilled = medRows.find((row) => hasSchedule(row.entry))
          const canApplyFirst = firstFilled && medRows.some((row) => !hasSchedule(row.entry))
          const yesterday = scheduleFor(pillsYesterday, patient)
          const fromYesterday = yesterday ? medRows.filter((row) => !hasSchedule(row.entry) && hasSchedule(yesterday[row.medKey])).length : 0
          return pages.map((pageMeds, pageIndex) => {
          const lastPage = pageIndex === pages.length - 1
          return <article
            className={`pill-form${willPrint ? '' : ' not-printing'}${unpicked ? ' pill-form-unpicked' : ''}${patient.rowNumber === lastPrintingRow && lastPage ? ' print-last' : ''}`}
            key={`${patient.rowNumber}-${pageIndex}`}>
            <div className="pill-form-head">
              <label className="pill-pick"><input type="checkbox" checked={pillSelection.has(patient.rowNumber)} onChange={() => onTogglePatient(patient.rowNumber)} /><span>تحديد للطباعة</span></label>
              <div className="pill-form-patient"><strong>{patient.name}</strong><span>{today}</span></div>
              <label className="pill-room">{roomLabel} <input inputMode="numeric" value={pillRooms[patient.rowNumber] || ''} onChange={(event) => setPillRooms((current) => ({ ...current, [patient.rowNumber]: event.target.value }))} /></label>
              <div className="pill-form-brand">
                <div className="pill-form-title"><strong>مستشفى بغداد التعليمي</strong><span>وحدة الصيدلة السريرية</span><span>{wardLabel}</span></div>
                <img className="hospital-logo header-logo" width="42" height="42" src={hospitalLogo} alt="" />
              </div>
            </div>
            <div className="pill-table-scroll">
              <table className="pill-table">
                <thead><tr><th scope="col"></th><th scope="col">العلاج</th><th className="pill-qty-cell" scope="col">كمية الحبوب</th><th scope="col">وقت الجرعة</th><th scope="col">طريقة الاستخدام</th><th scope="col">الملاحظات</th></tr></thead>
                <tbody>{pageMeds.map((med, medIndex) => {
                  const key = `${patient.rowNumber}:${med.key}`
                  // pillQty defaults to null, not '' — null means "never touched, show the
                  // chart's auto-filled quantity below"; '' means the pharmacist cleared it on
                  // purpose and must see it blank. Collapsing both to '' made backspacing the
                  // auto-filled value re-render it immediately (a controlled input snapping back
                  // to its old value), so the next keystroke appended after it instead of typing
                  // into an actually-empty field — e.g. clearing "10" to type "5" produced "105".
                  const entry = pillEntries[key] || { doseTime: '', usageMethod: '', note: '', pillQty: null, pillName: '' }
                  // One tap to carry the previous row's schedule down — a ward's pill form
                  // usually repeats the same «بعد الطعام» line for most medicines.
                  const prevEntry = medIndex > 0 ? pillEntries[`${patient.rowNumber}:${pageMeds[medIndex - 1].key}`] : null
                  const canRepeat = prevEntry && (prevEntry.doseTime || prevEntry.usageMethod || prevEntry.note)
                  const chartName = med.arabicName || med.name
                  const medName = entry.pillName ? entry.pillName : chartName
                  const chartQty = (pillsData.quantityByCell || {})[key]
                  const qtyValue = entry.pillQty !== null ? entry.pillQty : (chartQty != null ? String(chartQty) : '')
                  return <tr key={med.key}>
                    <td className="pill-lead-cell">{canRepeat && <button type="button" className="pill-repeat" title="نسخ وقت الجرعة والطريقة والملاحظة من السطر السابق" onClick={() => setPillEntries((current) => ({ ...current, [key]: { ...entry, doseTime: prevEntry.doseTime, usageMethod: prevEntry.usageMethod, note: prevEntry.note } }))}>↑ مثل السابق</button>}</td>
                    <td className="pill-name-cell">
                      <input dir="auto" aria-label={`العلاج — ${chartName}`} value={medName} onChange={(event) => setPillEntries((current) => ({ ...current, [key]: { ...entry, pillName: event.target.value } }))} />
                      {/* Prints via this span, not the input — see the extra rows below for why
                          the print CSS hides .pill-name-cell input outright. This row always has
                          a real name (chart-derived), so there's no blank case to worry about. */}
                      <span className="pill-name-cell-print">{medName}</span>
                    </td>
                    <td className="pill-qty-cell"><input inputMode="numeric" aria-label={`كمية الحبوب — ${chartName}`} value={qtyValue} onChange={(event) => { const next = event.target.value.replace(/\D/g, ''); setPillEntries((current) => ({ ...current, [key]: { ...entry, pillQty: next } })) }} /></td>
                    <td><PillSelect value={entry.doseTime} groups={doseTimeGroups} label={`وقت الجرعة — ${medName}`} onChange={(nextValue) => setPillEntries((current) => ({ ...current, [key]: { ...entry, doseTime: nextValue } }))} /></td>
                    <td><PillSelect value={entry.usageMethod} options={usageMethods} label={`طريقة الاستخدام — ${medName}`} onChange={(nextValue) => setPillEntries((current) => ({ ...current, [key]: { ...entry, usageMethod: nextValue } }))} /></td>
                    <td><PillSelect value={entry.note} options={noteOptions} label={`الملاحظات — ${medName}`} onChange={(nextValue) => setPillEntries((current) => ({ ...current, [key]: { ...entry, note: nextValue } }))} /></td>
                  </tr>
                })}{lastPage && extraRowsFor(extraCount).map((extra) => {
                  const key = `${patient.rowNumber}:${extra.key}`
                  const entry = pillEntries[key] || { doseTime: '', usageMethod: '', note: '', pillQty: '', pillName: '' }
                  return <tr className="pill-extra-row" key={extra.key}>
                    <td className="pill-lead-cell"></td>
                    <td className="pill-name-cell">
                      <input dir="auto" aria-label={`${extra.label} — العلاج`} placeholder="علاج إضافي" value={entry.pillName} onChange={(event) => setPillEntries((current) => ({ ...current, [key]: { ...entry, pillName: event.target.value } }))} />
                      {/* Printed via this span (see ExtraPillsScreen's medicine field for why):
                          an empty field should print truly blank, no hint text. */}
                      <span className="pill-name-cell-print">{entry.pillName}</span>
                    </td>
                    <td className="pill-qty-cell"><input inputMode="numeric" aria-label={`${extra.label} — كمية الحبوب`} value={entry.pillQty} onChange={(event) => { const next = event.target.value.replace(/\D/g, ''); setPillEntries((current) => ({ ...current, [key]: { ...entry, pillQty: next } })) }} /></td>
                    <td><PillSelect value={entry.doseTime} groups={doseTimeGroups} label={`${extra.label} — وقت الجرعة`} onChange={(nextValue) => setPillEntries((current) => ({ ...current, [key]: { ...entry, doseTime: nextValue } }))} /></td>
                    <td><PillSelect value={entry.usageMethod} options={usageMethods} label={`${extra.label} — طريقة الاستخدام`} onChange={(nextValue) => setPillEntries((current) => ({ ...current, [key]: { ...entry, usageMethod: nextValue } }))} /></td>
                    <td><PillSelect value={entry.note} options={noteOptions} label={`${extra.label} — الملاحظات`} onChange={(nextValue) => setPillEntries((current) => ({ ...current, [key]: { ...entry, note: nextValue } }))} /></td>
                  </tr>
                })}{lastPage && <tr className="pill-add-extra-row"><td colSpan={6}>
                  {/* Screen-only row (hidden in print): this patient's shortcuts. */}
                  <span className="pill-row-actions">
                    {fromYesterday > 0 && <button type="button" className="secondary-button compact" onClick={() => fillEmptyRows(medRows, (medKey) => yesterday[medKey])}>نسخ من استمارة الأمس ({fromYesterday})</button>}
                    {canApplyFirst && <button type="button" className="secondary-button compact" title="يملأ الأسطر الفارغة فقط بوقت الجرعة والطريقة والملاحظة من أول سطر مُعبّأ" onClick={() => fillEmptyRows(medRows, () => firstFilled.entry)}>تطبيق أول سطر على الفارغة</button>}
                    <button type="button" className="text-button" onClick={() => setExtraRowCounts((current) => ({ ...current, [patient.rowNumber]: extraCount + 1 }))}>+ سطر إضافي</button>
                  </span>
                </td></tr>}</tbody>
              </table>
            </div>
            <div className="pill-form-foot"><span className="pill-sign">توقيع الصيدلاني السريري</span><span className="pill-edit-time">وقت التحرير: {editTime}</span></div>
          </article>
        })
        })}
    </section>{confirmModal}
  </main>
}
