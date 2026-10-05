import { useState } from 'react'
import hospitalLogo from '../assets/hospital-logo.png'

// «استمارة متابعة الميروبينيم» — read-only, built by GET /api/meropenem from the ward's charts:
// every patient on Meronem in the chosen date's month, their dose, whether they are still on it,
// and one column per day they were, holding the course day (D1, D2 …; «D4؟» marks a day the
// chart skipped it but it carried on). Only patients still on it show until «إظهار المنتهين» is
// on. Same frame as the requisition (OrderScreen).
// With `drugs` (GET /api/antibiotics) it is «متابعة المضادات الحيوية»: every followed antibiotic,
// Meropenem included, one row per patient per drug, a drug filter, and D7+/D14+ cells marked as
// the usual stewardship review points.
const REVIEW_DAY = 7
const LONG_DAY = 14
const dayMonth = (iso) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`
const statusText = (status, antibiotics) => ({
  active: 'مستمر',
  stopped: antibiotics ? 'أُوقف العلاج' : 'أُوقف الميروبينيم',
  left: 'غادر الردهة',
  transferred: `نُقل إلى ${status.to || 'ردهة أخرى'}`,
}[status.kind] || '')

export default function MeropenemScreen({ header, wardLabel, today, onBack, selectedDate, onChangeDate, loading, data, loadError, onPrint, drugs, onEditDay }) {
  const [showEnded, setShowEnded] = useState(false)
  const [drugFilter, setDrugFilter] = useState('')
  const antibiotics = Boolean(drugs)
  const shownDrugs = (drugs || []).filter((drug) => !drugFilter || drug.key === drugFilter)
  const all = antibiotics ? shownDrugs.flatMap((drug) => drug.patients.map((patient) => ({ ...patient, drug: drug.label }))) : data?.patients || []
  const title = antibiotics ? 'Antibiotic follow up' : 'Meropenem follow up'
  const drugName = antibiotics ? 'المضادات الحيوية' : 'الميروبينيم'
  const endedCount = all.filter((patient) => patient.status.kind !== 'active').length
  const patients = showEnded ? all : all.filter((patient) => patient.status.kind === 'active')
  // Only the days some shown patient was on it — hidden patients leave no empty columns behind.
  const firstOfMonth = `${selectedDate.slice(0, 8)}01`
  const dates = [...new Set(patients.flatMap((patient) => Object.keys(patient.days)))].sort()
  // Antibiotics: one block per patient (all their drugs together, the name cell spanning them),
  // patients and their drugs in the order they started.
  const started = (patient) => Object.keys(patient.days).sort()[0] || ''
  const patientKey = (patient) => (patient.patientId ? `id:${patient.patientId}` : `name:${patient.name}`)
  const blocks = new Map()
  patients.forEach((patient) => {
    const key = antibiotics ? patientKey(patient) : `${patientKey(patient)}|${blocks.size}`
    if (!blocks.has(key)) blocks.set(key, [])
    blocks.get(key).push(patient)
  })
  const rows = [...blocks.values()]
    .map((block) => block.sort((a, b) => started(a).localeCompare(started(b)) || a.drug.localeCompare(b.drug)))
    .sort((a, b) => (antibiotics ? started(a[0]).localeCompare(started(b[0])) || a[0].name.localeCompare(b[0].name, 'ar') : 0))
    .flatMap((block) => block.map((patient, index) => ({ patient, span: index === 0 ? block.length : 0 })))

  return <main className="app-shell">
    {header}

    <section className="order-page meropenem-page">
      <div className="chart-toolbar order-toolbar">
        <button className="back-button" onClick={onBack}>→ العودة للردهات</button>
        <div><p className="modal-kicker">استمارة متابعة {drugName}</p><h1 dir="ltr">{title} : <bdi>{wardLabel}</bdi></h1></div>
        <div className="toolbar-actions">
          {antibiotics && drugs.length > 1 && <label className="pills-date">المضاد <select value={drugFilter} onChange={(event) => setDrugFilter(event.target.value)}>
            <option value="">الكل</option>
            {drugs.map((drug) => <option key={drug.key} value={drug.key}>{drug.label}</option>)}
          </select></label>}
          {endedCount > 0 && <button type="button" className="secondary-button compact" aria-pressed={showEnded} onClick={() => setShowEnded((on) => !on)}>{showEnded ? 'إخفاء المنتهين' : `إظهار المنتهين (${endedCount})`}</button>}
          <label className="pills-date">التاريخ <input type="date" value={selectedDate} onChange={(event) => onChangeDate(event.target.value)} /></label>
          <button className="primary-button compact" disabled={!patients.length} onClick={onPrint}>طباعة</button>
        </div>
      </div>

      <div className="order-print-head">
        <img className="hospital-logo" width="40" height="40" src={hospitalLogo} alt="" />
        <div>
          <strong>مستشفى بغداد التعليمي — وحدة الصيدلة السريرية</strong>
          <span dir="ltr">{title} : <bdi>{wardLabel}</bdi> — {today}</span>
        </div>
      </div>

      {loading ? <div className="empty-state"><span className="spinner" /><span>جارٍ تحميل الاستمارة…</span></div>
        : loadError ? <div className="empty-state"><strong>تعذّر تحميل الاستمارة</strong><span>حدّث الصفحة وحاول مجددًا.</span></div>
        : !all.length ? <div className="empty-state"><strong>لا يوجد مرضى على {drugName} هذا الشهر</strong><span>تُملأ الاستمارة تلقائيًا من الجارت عند إضافة {antibiotics ? 'أحد المضادات المتابَعة' : 'Meronem'} لأي مريض.</span></div>
        : !patients.length ? <div className="empty-state"><strong>لا يوجد مريض على {drugName} حاليًا</strong><span>المرضى الذين انتهى علاجهم هذا الشهر: اضغط «إظهار المنتهين ({endedCount})».</span></div>
        : <div className="order-table-scroll">
            <table className="pill-table meropenem-table">
              <thead><tr>
                <th scope="col">إسم المريض</th><th scope="col">رقم الطبلة</th>{antibiotics && <th scope="col">المضاد</th>}<th scope="col">الجرعة</th><th scope="col">الحالة</th>
                {dates.map((iso) => <th scope="col" key={iso} className="meropenem-day">{dayMonth(iso)}</th>)}
              </tr></thead>
              <tbody>{rows.map(({ patient, span }) => <tr key={`${patient.drug || ''}|${patient.patientId}|${patient.name}`} className={antibiotics && span ? 'meropenem-patient-start' : undefined}>
                {span > 0 && <td rowSpan={span}>{patient.name}</td>}
                {span > 0 && <td rowSpan={span} className="meropenem-id">{patient.patientId}</td>}
                {antibiotics && <td className="meropenem-dose" lang="en" dir="ltr">{patient.drug}</td>}
                <td className="meropenem-dose" lang="en" dir="ltr">{patient.dose}</td>
                <td className={`meropenem-status meropenem-status--${patient.status.kind}`}>{statusText(patient.status, antibiotics)}</td>
                {dates.map((iso) => {
                  const n = patient.days[iso]
                  const missed = patient.missed.includes(iso)
                  const length = antibiotics && n >= LONG_DAY ? ' meropenem-day--long' : antibiotics && n >= REVIEW_DAY ? ' meropenem-day--review' : ''
                  const editable = n && onEditDay && iso === Object.keys(patient.days).filter((day) => day >= firstOfMonth).sort()[0]
                  return <td key={iso} className={`meropenem-day${length}${missed ? ' meropenem-day--missed' : ''}`} title={missed ? 'غير مسجّل في الجارت هذا اليوم — تحقّق منه' : undefined}>{editable
                    ? <label className="meropenem-day-edit" title="يمكن تعديل اليوم الأول — الأيام التالية تتبعه">D<input type="number" min="1" max="365" inputMode="numeric" defaultValue={n} key={`${iso}|${n}`} onBlur={(event) => { const next = Number(event.target.value); if (Number.isInteger(next) && next >= 1 && next <= 365 && next !== n) onEditDay(patient, iso, next); else event.target.value = n }} onKeyDown={(event) => { if (event.key === 'Enter') event.target.blur() }} /></label>
                    : n ? `D${n}${missed ? '؟' : ''}` : ''}</td>
                })}
              </tr>)}</tbody>
            </table>
          </div>}
    </section>
  </main>
}
