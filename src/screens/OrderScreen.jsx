import hospitalLogo from '../assets/hospital-logo.png'

// The requisition ("الطلبية") — a read-only list built from the ward's main chart for the
// day: one row per medicine, its quantity summed across all patients, and that total spelled
// out in Arabic. RTL like the rest of the app, so التسلسل is the rightmost column.
export default function OrderScreen({ header, wardLabel, today, onBack, selectedDate, onChangeDate, loading, data, loadError, onPrint }) {
  const items = data?.items || []

  return <main className="app-shell">
    {header}

    <section className="order-page">
      <div className="chart-toolbar order-toolbar">
        <button className="back-button" onClick={onBack}>→ العودة للردهات</button>
        <div><p className="modal-kicker">طلبية الأدوية</p><h1>{wardLabel}</h1></div>
        <div className="toolbar-actions">
          <label className="pills-date">التاريخ <input type="date" value={selectedDate} onChange={(event) => onChangeDate(event.target.value)} /></label>
          <button className="primary-button compact" disabled={!items.length} onClick={onPrint}>طباعة</button>
        </div>
      </div>

      <div className="order-print-head">
        <img className="hospital-logo" width="40" height="40" src={hospitalLogo} alt="" />
        <div>
          <strong>مستشفى بغداد التعليمي — وحدة الصيدلة السريرية</strong>
          <span>طلبية الأدوية — {wardLabel} — {today}</span>
        </div>
      </div>

      {loading ? <div className="empty-state"><span className="spinner" /><span>جارٍ تحميل الطلبية…</span></div>
        : loadError ? <div className="empty-state"><strong>تعذّر تحميل الطلبية</strong><span>حدّث الصفحة وحاول مجددًا.</span></div>
        : !items.length ? <div className="empty-state"><strong>لا توجد طلبية لهذا اليوم</strong><span>سجّل جارت هذه الردهة أولًا، ثم تُبنى الطلبية تلقائيًا من كمياته.</span></div>
        : <div className="order-table-scroll">
            <table className="pill-table order-table">
              <thead><tr><th scope="col">التسلسل</th><th scope="col">اسم الدواء</th><th scope="col">الكمية</th><th scope="col">الكمية كتابةً</th></tr></thead>
              <tbody>{items.map((item, index) => <tr key={item.name}>
                <td className="order-serial">{index + 1}</td>
                <td>{item.name}</td>
                <td className="order-qty">{item.quantity}</td>
                <td>{item.quantityWords}</td>
              </tr>)}</tbody>
            </table>
          </div>}
    </section>
  </main>
}
