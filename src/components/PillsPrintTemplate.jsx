import { forwardRef } from 'react'
import hospitalLogo from '../assets/hospital-logo.png'
import { SHEETS_PER_CANVAS } from '../usePdfSheets.js'

// The pills form as paper, drawn off-screen for usePdfSheets: plain text only, one A4 portrait
// .ppt-sheet per form page. Same content as the on-screen form (PillsScreen / ExtraPillsScreen)
// minus the screen-only working column. Each text is a single element so html2canvas keeps
// Arabic letters joined (see ChartPrintTemplate). sheets: [{ key, patientName, today, room,
// roomLabel, wardLabel, editTime, rows: [{ name, doseTime, usageMethod, note }] }]; the spare
// rows are just blank entries in `rows`.
const PillsPrintTemplate = forwardRef(function PillsPrintTemplate({ sheets }, ref) {
  const chunks = Array.from({ length: Math.ceil(sheets.length / SHEETS_PER_CANVAS) }, (_, index) => sheets.slice(index * SHEETS_PER_CANVAS, (index + 1) * SHEETS_PER_CANVAS))
  return <div ref={ref} className="ppt-root">{chunks.map((chunk) => <div key={chunk[0].key} className="ppt-chunk">{chunk.map((sheet) => <section key={sheet.key} className="ppt-sheet">
    <div className="ppt-form">
      <div className="ppt-head">
        <div className="ppt-patient"><strong>{sheet.patientName}</strong><span>{sheet.today}</span></div>
        <div className="ppt-room"><span>{sheet.roomLabel}</span><span className="ppt-room-value">{sheet.room}</span></div>
        <div className="ppt-brand">
          <div className="ppt-title"><strong>مستشفى بغداد التعليمي</strong><span>وحدة الصيدلة السريرية</span><span>{sheet.wardLabel}</span></div>
          <img src={hospitalLogo} alt="" width="42" height="42" />
        </div>
      </div>
      <table className="ppt-table">
        <thead><tr><th></th><th>العلاج</th><th>وقت الجرعة</th><th>طريقة الاستخدام</th><th>الملاحظات</th></tr></thead>
        <tbody>{sheet.rows.map((row, index) => <tr key={index}>
          <td></td><td className="ppt-name">{row.name}</td><td>{row.doseTime}</td><td>{row.usageMethod}</td><td>{row.note}</td>
        </tr>)}</tbody>
      </table>
      <div className="ppt-foot"><span className="ppt-sign">توقيع الصيدلاني السريري</span><span>وقت التحرير: {sheet.editTime}</span></div>
    </div>
  </section>)}</div>)}</div>
})

export default PillsPrintTemplate
