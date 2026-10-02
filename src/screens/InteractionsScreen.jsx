import hospitalLogo from '../assets/hospital-logo.png'

// «التداخلات الدوائية» — read-only and never stored: App.jsx fetches the ward's chart(s) for the
// chosen day and interactionsForChart (helpers.js) checks each patient's medicines against the
// bundled rule list (interactions.js). `data` is [{ slot, patients }], one entry per chart.
export default function InteractionsScreen({ header, wardLabel, today, onBack, selectedDate, onChangeDate, loading, data, loadError, onPrint }) {
  const charts = data || []
  const total = charts.reduce((sum, chart) => sum + chart.patients.length, 0)

  return <main className="app-shell">
    {header}

    <section className="order-page interactions-page">
      <div className="chart-toolbar order-toolbar">
        <button className="back-button" onClick={onBack}>→ العودة للردهات</button>
        <div><p className="modal-kicker">التداخلات الدوائية</p><h1><bdi>{wardLabel}</bdi></h1></div>
        <div className="toolbar-actions">
          <label className="pills-date">التاريخ <input type="date" value={selectedDate} onChange={(event) => onChangeDate(event.target.value)} /></label>
          <button className="primary-button compact" disabled={!total} onClick={onPrint}>طباعة</button>
        </div>
      </div>

      <div className="order-print-head">
        <img className="hospital-logo" width="40" height="40" src={hospitalLogo} alt="" />
        <div>
          <strong>مستشفى بغداد التعليمي — وحدة الصيدلة السريرية</strong>
          <span>التداخلات الدوائية : <bdi>{wardLabel}</bdi> — {selectedDate}</span>
        </div>
      </div>

      {loading ? <div className="empty-state"><span className="spinner" /><span>جارٍ فحص الجارت…</span></div>
        : loadError ? <div className="empty-state"><strong>تعذّر تحميل الجارت</strong><span>حدّث الصفحة وحاول مجددًا.</span></div>
        : !total ? <div className="empty-state"><strong>لا توجد تداخلات دوائية في جارت هذا اليوم</strong><span>الفحص يعتمد على قائمة تداخلات معروفة وليس شاملًا — لا يغني عن مراجعة الصيدلي.</span></div>
        : <div className="order-table-scroll">
            <table className="pill-table interactions-table">
              <thead><tr><th scope="col">إسم المريض</th><th scope="col">رقم الطبلة</th><th scope="col" dir="ltr">Drugs</th><th scope="col" dir="ltr">Risk</th><th scope="col" dir="ltr">Notes</th></tr></thead>
              <tbody>{charts.flatMap((chart) => chart.patients.flatMap((patient) => patient.pairs.map((pair, index) => <tr key={`${chart.slot}|${patient.rowNumber}|${index}`}>
                <td>{index === 0 ? `${patient.name}${chart.slot === 'extra' ? ' (إضافي)' : ''}` : ''}</td>
                <td className="interactions-id">{index === 0 ? patient.patientId : ''}</td>
                <td lang="en" dir="ltr">{pair.a} + {pair.b}</td>
                <td lang="en" dir="ltr" className={`interactions-severity interactions-severity--${pair.severity}`}>{pair.severity.charAt(0).toUpperCase() + pair.severity.slice(1)}</td>
                <td lang="en" dir="ltr">{pair.note}</td>
              </tr>)))}</tbody>
            </table>
          </div>}
      <p className="interactions-disclaimer">قائمة التداخلات المعروفة داخل البرنامج للتنبيه فقط وليست شاملة — راجع المرجع الدوائي قبل أي قرار.</p>
    </section>
  </main>
}
