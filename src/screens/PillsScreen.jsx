import hospitalLogo from '../assets/hospital-logo.png'
import AppCredit from '../components/AppCredit.jsx'
import ThemeToggle from '../components/ThemeToggle.jsx'
import TopBarBrand from '../components/TopBarBrand.jsx'
import PillSelect from '../components/PillSelect.jsx'
import { doseTimes, usageMethods, noteOptions } from '../constants.js'

// The 18 dose times are a flat list on the server; split here for the picker only so a
// single "٨ صباحًا" isn't buried among the "٨ صباحًا - ٤ عصرًا - ١٢ ليلًا" schedules.
const doseTimeGroups = [
  ['أوقات مفردة', doseTimes.filter((time) => !time.includes(' - '))],
  ['جداول موزّعة', doseTimes.filter((time) => time.includes(' - '))],
]

export default function PillsScreen({
  wardLabel, today, editTime, currentUser, theme, onToggleTheme, onLogout, goHome, onBack,
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
    <AppCredit />
    <header className="topbar">
      <TopBarBrand onClick={goHome} />
      <div className="user-menu">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        <span>{currentUser?.fullName || 'مستخدم'}</span>
        <button onClick={onLogout} className="text-button">تسجيل الخروج</button>
      </div>
    </header>

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
        : pillsData.patients.map((patient) => {
          const unpicked = pillSelection.size > 0 && !pillSelection.has(patient.rowNumber)
          const willPrint = printScope === 'all' || pillSelection.has(patient.rowNumber)
          return <article
            className={`pill-form${willPrint ? '' : ' not-printing'}${unpicked ? ' pill-form-unpicked' : ''}${patient.rowNumber === lastPrintingRow ? ' print-last' : ''}`}
            key={patient.rowNumber}>
            <div className="pill-form-head">
              <label className="pill-pick"><input type="checkbox" checked={pillSelection.has(patient.rowNumber)} onChange={() => onTogglePatient(patient.rowNumber)} /><span>تحديد للطباعة</span></label>
              <div className="pill-form-patient"><strong>{patient.name}</strong><span>{today}</span></div>
              <label className="pill-room">رقم الغرفة <input inputMode="numeric" value={pillRooms[patient.rowNumber] || ''} onChange={(event) => setPillRooms((current) => ({ ...current, [patient.rowNumber]: event.target.value }))} /></label>
              <div className="pill-form-brand">
                <div className="pill-form-title"><strong>مستشفى بغداد التعليمي</strong><span>وحدة الصيدلة السريرية</span><span>{wardLabel}</span></div>
                <img className="hospital-logo header-logo" width="42" height="42" src={hospitalLogo} alt="" />
              </div>
            </div>
            <div className="pill-table-scroll">
              <table className="pill-table">
                <thead><tr><th scope="col"></th><th scope="col">العلاج</th><th scope="col">وقت الجرعة</th><th scope="col">طريقة الاستخدام</th><th scope="col">الملاحظات</th></tr></thead>
                <tbody>{pillsData.medicines.filter((med) => (pillsData.matrix[patient.rowNumber] || []).includes(med.key)).map((med) => {
                  const key = `${patient.rowNumber}:${med.key}`
                  const entry = pillEntries[key] || { doseTime: '', usageMethod: '', note: '' }
                  const medName = med.arabicName || med.name
                  return <tr key={med.key}>
                    <td className="pill-lead-cell"></td>
                    <td>{medName}</td>
                    <td><PillSelect value={entry.doseTime} groups={doseTimeGroups} label={`وقت الجرعة — ${medName}`} onChange={(nextValue) => setPillEntries((current) => ({ ...current, [key]: { ...entry, doseTime: nextValue } }))} /></td>
                    <td><PillSelect value={entry.usageMethod} options={usageMethods} label={`طريقة الاستخدام — ${medName}`} onChange={(nextValue) => setPillEntries((current) => ({ ...current, [key]: { ...entry, usageMethod: nextValue } }))} /></td>
                    <td><PillSelect value={entry.note} options={noteOptions} label={`الملاحظات — ${medName}`} onChange={(nextValue) => setPillEntries((current) => ({ ...current, [key]: { ...entry, note: nextValue } }))} /></td>
                  </tr>
                })}</tbody>
              </table>
            </div>
            <div className="pill-form-foot"><span className="pill-sign">توقيع الصيدلاني السريري</span><span className="pill-edit-time">وقت التحرير: {editTime}</span></div>
          </article>
        })}
    </section>{confirmModal}
  </main>
}
