import hospitalLogo from '../assets/hospital-logo.png'

// «استمارة متابعة الميروبينيم» — read-only, built by GET /api/meropenem from the ward's charts:
// every patient on Meronem in the chosen date's month, their dose, and one column per day up to
// the chosen date holding the course day (D1, D2 …). Same frame as the requisition (OrderScreen).
const dayMonth = (iso) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`

export default function MeropenemScreen({ header, wardLabel, today, onBack, selectedDate, onChangeDate, loading, data, loadError, onPrint }) {
  const dates = data?.dates || []
  const patients = data?.patients || []

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
        : !patients.length ? <div className="empty-state"><strong>لا يوجد مرضى على الميروبينيم هذا الشهر</strong><span>تُملأ الاستمارة تلقائيًا من الجارت عند إضافة Meronem لأي مريض.</span></div>
        : <div className="order-table-scroll">
            <table className="pill-table meropenem-table">
              <thead><tr>
                <th scope="col">إسم المريض</th><th scope="col">رقم الطبلة</th><th scope="col">الجرعة</th>
                {dates.map((iso) => <th scope="col" key={iso} className="meropenem-day">{dayMonth(iso)}</th>)}
              </tr></thead>
              <tbody>{patients.map((patient) => <tr key={`${patient.patientId}|${patient.name}`}>
                <td>{patient.name}</td>
                <td className="meropenem-id">{patient.patientId}</td>
                <td className="meropenem-dose" lang="en" dir="ltr">{patient.dose}</td>
                {dates.map((iso) => <td key={iso} className="meropenem-day">{patient.days[iso] ? `D${patient.days[iso]}` : ''}</td>)}
              </tr>)}</tbody>
            </table>
          </div>}
    </section>
  </main>
}
