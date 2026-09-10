import hospitalLogo from '../assets/hospital-logo.png'
import PillSelect from '../components/PillSelect.jsx'
import { doseTimes, usageMethods, noteOptions } from '../constants.js'

// The 18 dose times are a flat list on the server; split here for the picker only so a
// single "٨ صباحًا" isn't buried among the "٨ صباحًا - ٤ عصرًا - ١٢ ليلًا" schedules.
const doseTimeGroups = [
  ['أوقات مفردة', doseTimes.filter((time) => !time.includes(' - '))],
  ['جداول موزّعة', doseTimes.filter((time) => time.includes(' - '))],
]

// Two always-present spare rows per patient for a medicine the chart doesn't carry. Editable
// on screen (kept as pill_entries under these synthetic keys), and printed blank when unused —
// the ruled hand-write rows the form always had.
const EXTRA_ROWS = [
  { key: 'extra-row-1', label: 'سطر إضافي ١' },
  { key: 'extra-row-2', label: 'سطر إضافي ٢' },
]

export default function PillsScreen({
  header, wardLabel, roomLabel, today, editTime, onBack,
  selectedDate, onChangeDate, pillsLoading, pillsData, pillsSaveStatus, pillsLoadError,
  pillEntries, setPillEntries, pillRooms, setPillRooms, pillSelection, onTogglePatient,
  printScope, lastPrintingRow, onPrint, confirmModal,
}) {
  const saveErrored = pillsLoadError || pillsSaveStatus === 'error'
  const saveText = pillsLoadError ? '⚠ تعذّر تحميل الاستمارة — إعادة المحاولة…'
    : pillsSaveStatus === 'error' ? '⚠ لم يُحفظ — تُعاد المحاولة…'
    : pillsSaveStatus === 'saving' ? '⟳ جارٍ الحفظ…'
    : pillsSaveStatus === 'pending' ? '○ لم يُحفظ بعد…'
    : '● محفوظ تلقائيًا'
  const saveClass = saveErrored ? 'save-state save-state-error'
    : pillsSaveStatus === 'saving' ? 'save-state save-state-saving'
    : pillsSaveStatus === 'pending' ? 'save-state save-state-pending'
    : 'save-state'

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
          <button className="primary-button compact" onClick={() => onPrint('all')}>طباعة الكل</button>
          <button className="secondary-button compact" disabled={pillSelection.size === 0} onClick={() => onPrint('selected')}>طباعة المحدّدين ({pillSelection.size})</button>
        </div>
      </div>

      {pillsData && pillsData.patients.length > 0 && (
        pillSelection.size === 0
          ? <p className="pills-pick-note">للطباعة المحدّدة، أشّر «تحديد للطباعة» في بطاقة كل مريض مطلوب.</p>
          : <p className="pills-pick-note pills-pick-note-active"><strong>المحدَّدون للطباعة ({pillSelection.size}):</strong> {selectedNames.join('، ')}</p>
      )}

      {pillsLoading ? <div className="empty-state"><span className="spinner" /><span>جارٍ تحميل الاستمارة…</span></div>
        : !pillsData ? <div className="empty-state"><strong>لا يوجد جارت لهذا اليوم</strong><span>سجّل جارت هذه الردهة أولًا، ثم ستُبنى استمارة الحبوب تلقائيًا.</span></div>
        : pillsData.patients.length === 0 ? <div className="empty-state"><strong>لا حبوب لعرضها</strong><span>لا يوجد مريض لديه علاج أقراص أو كبسولات (Tab / Cap) في جارت هذا اليوم.</span></div>
        : pillsData.patients.flatMap((patient) => {
          const unpicked = pillSelection.size > 0 && !pillSelection.has(patient.rowNumber)
          const willPrint = printScope === 'all' || pillSelection.has(patient.rowNumber)
          const patientMeds = pillsData.medicines.filter((med) => (pillsData.matrix[patient.rowNumber] || []).includes(med.key))
          // One printed sheet holds 7 medicine rows; anything past that starts a fresh page
          // carrying the same header. The two hand-write rows ride only on the last page.
          const pages = []
          for (let i = 0; i < patientMeds.length; i += 7) pages.push(patientMeds.slice(i, i + 7))
          if (pages.length === 0) pages.push([])
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
                <tbody>{pageMeds.map((med) => {
                  const key = `${patient.rowNumber}:${med.key}`
                  const entry = pillEntries[key] || { doseTime: '', usageMethod: '', note: '', pillQty: '', pillName: '' }
                  const chartName = med.arabicName || med.name
                  const medName = entry.pillName ? entry.pillName : chartName
                  const chartQty = (pillsData.quantityByCell || {})[key]
                  const qtyValue = entry.pillQty !== undefined && entry.pillQty !== '' ? entry.pillQty : (chartQty != null ? String(chartQty) : '')
                  return <tr key={med.key}>
                    <td className="pill-lead-cell"></td>
                    <td className="pill-name-cell"><input aria-label={`العلاج — ${chartName}`} value={medName} onChange={(event) => setPillEntries((current) => ({ ...current, [key]: { ...entry, pillName: event.target.value } }))} /></td>
                    <td className="pill-qty-cell"><input inputMode="numeric" aria-label={`كمية الحبوب — ${chartName}`} value={qtyValue} onChange={(event) => { const next = event.target.value.replace(/\D/g, ''); setPillEntries((current) => ({ ...current, [key]: { ...entry, pillQty: next } })) }} /></td>
                    <td><PillSelect value={entry.doseTime} groups={doseTimeGroups} label={`وقت الجرعة — ${medName}`} onChange={(nextValue) => setPillEntries((current) => ({ ...current, [key]: { ...entry, doseTime: nextValue } }))} /></td>
                    <td><PillSelect value={entry.usageMethod} options={usageMethods} label={`طريقة الاستخدام — ${medName}`} onChange={(nextValue) => setPillEntries((current) => ({ ...current, [key]: { ...entry, usageMethod: nextValue } }))} /></td>
                    <td><PillSelect value={entry.note} options={noteOptions} label={`الملاحظات — ${medName}`} onChange={(nextValue) => setPillEntries((current) => ({ ...current, [key]: { ...entry, note: nextValue } }))} /></td>
                  </tr>
                })}{lastPage && EXTRA_ROWS.map((extra) => {
                  const key = `${patient.rowNumber}:${extra.key}`
                  const entry = pillEntries[key] || { doseTime: '', usageMethod: '', note: '', pillQty: '', pillName: '' }
                  return <tr className="pill-extra-row" key={extra.key}>
                    <td className="pill-lead-cell"></td>
                    <td className="pill-name-cell"><input aria-label={`${extra.label} — العلاج`} placeholder="علاج إضافي" value={entry.pillName} onChange={(event) => setPillEntries((current) => ({ ...current, [key]: { ...entry, pillName: event.target.value } }))} /></td>
                    <td className="pill-qty-cell"><input inputMode="numeric" aria-label={`${extra.label} — كمية الحبوب`} value={entry.pillQty} onChange={(event) => { const next = event.target.value.replace(/\D/g, ''); setPillEntries((current) => ({ ...current, [key]: { ...entry, pillQty: next } })) }} /></td>
                    <td><PillSelect value={entry.doseTime} groups={doseTimeGroups} label={`${extra.label} — وقت الجرعة`} onChange={(nextValue) => setPillEntries((current) => ({ ...current, [key]: { ...entry, doseTime: nextValue } }))} /></td>
                    <td><PillSelect value={entry.usageMethod} options={usageMethods} label={`${extra.label} — طريقة الاستخدام`} onChange={(nextValue) => setPillEntries((current) => ({ ...current, [key]: { ...entry, usageMethod: nextValue } }))} /></td>
                    <td><PillSelect value={entry.note} options={noteOptions} label={`${extra.label} — الملاحظات`} onChange={(nextValue) => setPillEntries((current) => ({ ...current, [key]: { ...entry, note: nextValue } }))} /></td>
                  </tr>
                })}</tbody>
              </table>
            </div>
            <div className="pill-form-foot"><span className="pill-sign">توقيع الصيدلاني السريري</span><span className="pill-edit-time">وقت التحرير: {editTime}</span></div>
          </article>
        })
        })}
    </section>{confirmModal}
  </main>
}
