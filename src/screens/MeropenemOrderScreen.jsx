import hospitalLogo from '../assets/hospital-logo.png'

// «طلبية الميرونيم» — read-only, built by GET /api/meropenem-order from the ward's MAIN chart for
// the day: one line per patient on Meronem with the dose and the vial count. Same frame (and
// print rules) as the requisition (OrderScreen).
export default function MeropenemOrderScreen({ header, wardLabel, today, onBack, selectedDate, onChangeDate, loading, data, loadError, onPrint }) {
  const items = data?.items || []

  return <main className="app-shell">
    {header}

    <section className="order-page">
      <div className="chart-toolbar order-toolbar">
        <button className="back-button" onClick={onBack}>→ العودة للردهات</button>
        <div><p className="modal-kicker">طلبية الميرونيم</p><h1>{wardLabel}</h1></div>
        <div className="toolbar-actions">
          <label className="pills-date">التاريخ <input type="date" value={selectedDate} onChange={(event) => onChangeDate(event.target.value)} /></label>
          <button className="primary-button compact" disabled={!items.length} onClick={onPrint}>طباعة</button>
        </div>
      </div>

      <div className="order-print-head">
        <img className="hospital-logo" width="40" height="40" src={hospitalLogo} alt="" />
        <div>
          <strong>مستشفى بغداد التعليمي — وحدة الصيدلة السريرية</strong>
          <span>طلبية الميرونيم — {wardLabel} — {today}</span>
        </div>
      </div>

      {loading ? <div className="empty-state"><span className="spinner" /><span>جارٍ تحميل الطلبية…</span></div>
        : loadError ? <div className="empty-state"><strong>تعذّر تحميل الطلبية</strong><span>حدّث الصفحة وحاول مجددًا.</span></div>
        : !items.length ? <div className="empty-state"><strong>لا يوجد مرضى على الميرونيم في جارت هذا اليوم</strong><span>تُبنى الطلبية تلقائيًا من الجارت الرئيسي عند تسجيل Meronem لأي مريض.</span></div>
        : <div className="order-table-scroll">
            <table className="pill-table order-table meropenem-order-table">
              <thead><tr>
                <th scope="col">اسم المريض</th><th scope="col">رقم الطبلة</th><th scope="col">الجرعة</th><th scope="col">العدد</th>
              </tr></thead>
              <tbody>{items.map((item, index) => <tr key={`${item.patientId}|${item.name}|${index}`}>
                <td>{item.name}</td>
                <td className="meropenem-id">{item.patientId}</td>
                <td className="meropenem-dose" lang="en" dir="ltr">{item.dose}</td>
                <td className="order-qty">{item.count}</td>
              </tr>)}</tbody>
            </table>
          </div>}
    </section>
  </main>
}
