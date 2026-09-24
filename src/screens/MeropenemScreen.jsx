import { useState } from 'react'
import hospitalLogo from '../assets/hospital-logo.png'

// «استمارة متابعة الميروبينيم» — read-only, built by GET /api/meropenem from the ward's charts:
// every patient on Meronem in the chosen date's month, their dose, whether they are still on it,
// and one column per day they were, holding the course day (D1, D2 …; «D4؟» marks a day the
// chart skipped it but it carried on). Only patients still on it show until «إظهار المنتهين» is
// on. Same frame as the requisition (OrderScreen).
const dayMonth = (iso) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`
const statusText = (status) => ({
  active: 'مستمر',
  stopped: 'أُوقف الميروبينيم',
  left: 'غادر الردهة',
  transferred: `نُقل إلى ${status.to || 'ردهة أخرى'}`,
}[status.kind] || '')

export default function MeropenemScreen({ header, wardLabel, today, onBack, selectedDate, onChangeDate, loading, data, loadError, onPrint }) {
  const [showEnded, setShowEnded] = useState(false)
  const all = data?.patients || []
  const endedCount = all.filter((patient) => patient.status.kind !== 'active').length
  const patients = showEnded ? all : all.filter((patient) => patient.status.kind === 'active')
  // Only the days some shown patient was on it — hidden patients leave no empty columns behind.
  const dates = [...new Set(patients.flatMap((patient) => Object.keys(patient.days)))].sort()

  return <main className="app-shell">
    {header}

    <section className="order-page meropenem-page">
      <div className="chart-toolbar order-toolbar">
        <button className="back-button" onClick={onBack}>→ العودة للردهات</button>
        <div><p className="modal-kicker">استمارة متابعة الميروبينيم</p><h1 dir="ltr">Meropenem follow up : <bdi>{wardLabel}</bdi></h1></div>
        <div className="toolbar-actions">
          {endedCount > 0 && <button type="button" className="secondary-button compact" aria-pressed={showEnded} onClick={() => setShowEnded((on) => !on)}>{showEnded ? 'إخفاء المنتهين' : `إظهار المنتهين (${endedCount})`}</button>}
          <label className="pills-date">التاريخ <input type="date" value={selectedDate} onChange={(event) => onChangeDate(event.target.value)} /></label>
          <button className="primary-button compact" disabled={!patients.length} onClick={onPrint}>طباعة</button>
        </div>
      </div>

      <div className="order-print-head">
        <img className="hospital-logo" width="40" height="40" src={hospitalLogo} alt="" />
        <div>
          <strong>مستشفى بغداد التعليمي — وحدة الصيدلة السريرية</strong>
          <span dir="ltr">Meropenem follow up : <bdi>{wardLabel}</bdi> — {today}</span>
        </div>
      </div>

      {loading ? <div className="empty-state"><span className="spinner" /><span>جارٍ تحميل الاستمارة…</span></div>
        : loadError ? <div className="empty-state"><strong>تعذّر تحميل الاستمارة</strong><span>حدّث الصفحة وحاول مجددًا.</span></div>
        : !all.length ? <div className="empty-state"><strong>لا يوجد مرضى على الميروبينيم هذا الشهر</strong><span>تُملأ الاستمارة تلقائيًا من الجارت عند إضافة Meronem لأي مريض.</span></div>
        : !patients.length ? <div className="empty-state"><strong>لا يوجد مريض على الميروبينيم حاليًا</strong><span>المرضى الذين انتهى علاجهم هذا الشهر: اضغط «إظهار المنتهين ({endedCount})».</span></div>
        : <div className="order-table-scroll">
            <table className="pill-table meropenem-table">
              <thead><tr>
                <th scope="col">إسم المريض</th><th scope="col">رقم الطبلة</th><th scope="col">الجرعة</th><th scope="col">الحالة</th>
                {dates.map((iso) => <th scope="col" key={iso} className="meropenem-day">{dayMonth(iso)}</th>)}
              </tr></thead>
              <tbody>{patients.map((patient) => <tr key={`${patient.patientId}|${patient.name}`}>
                <td>{patient.name}</td>
                <td className="meropenem-id">{patient.patientId}</td>
                <td className="meropenem-dose" lang="en" dir="ltr">{patient.dose}</td>
                <td className={`meropenem-status meropenem-status--${patient.status.kind}`}>{statusText(patient.status)}</td>
                {dates.map((iso) => {
                  const n = patient.days[iso]
                  const missed = patient.missed.includes(iso)
                  return <td key={iso} className={`meropenem-day${missed ? ' meropenem-day--missed' : ''}`} title={missed ? 'غير مسجّل في الجارت هذا اليوم — تحقّق منه' : undefined}>{n ? `D${n}${missed ? '؟' : ''}` : ''}</td>
                })}
              </tr>)}</tbody>
            </table>
          </div>}
    </section>
  </main>
}
