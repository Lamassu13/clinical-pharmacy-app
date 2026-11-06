import hospitalLogo from '../assets/hospital-logo.png'

// «استمارة متابعة الميروبينيم» — read-only, built by GET /api/meropenem from the ward's charts:
// every patient on Meronem in the chosen date's month, their dose, whether they are still on it,
// and one column per day they were, holding the course day (D1, D2 …; «D4؟» marks a day the
// chart skipped it but it carried on). Only patients still on it are shown. Same frame as the
// requisition (OrderScreen).
const dayMonth = (iso) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`
const statusText = (status) => ({
  active: 'مستمر',
  stopped: 'أُوقف الميروبينيم',
  left: 'غادر الردهة',
  transferred: `نُقل إلى ${status.to || 'ردهة أخرى'}`,
}[status.kind] || '')

export default function MeropenemScreen({ header, footer, wardLabel, today, onBack, selectedDate, onChangeDate, loading, data, loadError, onPrint, onEditDay }) {
  const all = data?.patients || []
  const patients = all.filter((patient) => patient.status.kind === 'active')
  // Only the days some shown patient was on it — hidden patients leave no empty columns behind.
  const firstOfMonth = `${selectedDate.slice(0, 8)}01`
  const dates = [...new Set(patients.flatMap((patient) => Object.keys(patient.days)))].sort()

  return <main className="app-shell">
    {header}

    <section className="order-page meropenem-page">
      <div className="chart-toolbar order-toolbar">
        <button className="back-button" onClick={onBack}>→ العودة للردهات</button>
        <div><p className="modal-kicker">استمارة متابعة الميروبينيم</p><h1 dir="ltr">Meropenem follow up : <bdi>{wardLabel}</bdi></h1></div>
        <div className="toolbar-actions">
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
        : !patients.length ? <div className="empty-state"><strong>لا يوجد مريض على الميروبينيم حاليًا</strong><span>تُعرض في الاستمارة الحالات المستمرة فقط.</span></div>
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
                  const editable = n && onEditDay && iso === Object.keys(patient.days).filter((day) => day >= firstOfMonth).sort()[0]
                  return <td key={iso} className={`meropenem-day${missed ? ' meropenem-day--missed' : ''}`} title={missed ? 'غير مسجّل في الجارت هذا اليوم — تحقّق منه' : undefined}>{editable
                    ? <label className="meropenem-day-edit" title="يمكن تعديل اليوم الأول — الأيام التالية تتبعه">D<input type="number" min="1" max="365" inputMode="numeric" defaultValue={n} key={`${iso}|${n}`} onBlur={(event) => { const next = Number(event.target.value); if (Number.isInteger(next) && next >= 1 && next <= 365 && next !== n) onEditDay(patient, iso, next); else event.target.value = n }} onKeyDown={(event) => { if (event.key === 'Enter') event.target.blur() }} /></label>
                    : n ? `D${n}${missed ? '؟' : ''}` : ''}</td>
                })}
              </tr>)}</tbody>
            </table>
          </div>}
    </section>
    {footer}
  </main>
}
