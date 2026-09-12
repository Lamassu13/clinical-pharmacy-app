import { Fragment, forwardRef } from 'react'
import hospitalLogo from '../assets/hospital-logo.png'
import { CHART_COLUMNS, PATIENT_ROWS } from '../constants.js'

// A dedicated, static render of the chart for export — plain text, no inputs, no scrolling.
// Captured with html2canvas and dropped into a fixed-size PDF (see exportChartPdf in App.jsx)
// instead of handing the live editable DOM to window.print(), so the output looks identical
// regardless of which device/browser/printer generates it (see the plan this replaces:
// jaunty-marinating-koala.md). Sized in mm at exactly the A4 landscape ratio (297:210) so the
// captured canvas drops into the PDF page with zero letterboxing/stretching.
//
// The old @media print CSS capped body rows at a conservative 2.8mm each because it had to
// leave headroom against a real, unknown printer margin — filling the page any further
// risked spilling onto a second physical page (see this session's history in
// jaunty-marinating-koala.md). None of that applies here: this template always renders into
// one fixed 297x210mm canvas by construction, so there's nothing to protect against — the
// space inside a real 12.7mm margin on all four sides (minus the header) is simply divided
// across all 41 rows plus the totals. Always all 41 rows (not just the filled ones): the
// chart is one fixed-size form either way, and this way every row gets an identical,
// generous height regardless of how many patients are in it.
const HEAD_MM = 28
const NAME_COL_MM = 28
const PAGE_HEIGHT_MM = 210
const MARGIN_MM = 12.7

const ChartPrintTemplate = forwardRef(function ChartPrintTemplate({ selected, today, todayWeekday, isThursday, patientNames, columnMedicines, quantities, totals }, ref) {
  const footRows = isThursday ? 2 : 1
  const innerHeight = PAGE_HEIGHT_MM - MARGIN_MM * 2
  const rowMM = (innerHeight - HEAD_MM) / (PATIENT_ROWS + footRows)
  const gridTemplateRows = `${HEAD_MM}mm repeat(${PATIENT_ROWS}, ${rowMM}mm) repeat(${footRows}, ${rowMM}mm)`

  return <div ref={ref} className="chart-print-template" style={{ gridTemplateRows, gridTemplateColumns: `${NAME_COL_MM}mm repeat(${CHART_COLUMNS}, 1fr)` }}>
    <div className="cpt-cell cpt-corner">
      <img src={hospitalLogo} alt="" />
      <span>مستشفى بغداد التعليمي</span>
      <span>وحدة الصيدلة السريرية</span>
      {selected.floor && <span>الطابق {selected.floor}</span>}
      <span>{selected.ward}</span>
      <span>{today}</span>
      <span>{todayWeekday}</span>
    </div>
    {columnMedicines.map((name, columnIndex) => <div key={columnIndex} className="cpt-cell cpt-col-head"><span className="cpt-col-head-text">{name}</span></div>)}

    {patientNames.map((name, rowIndex) => <Fragment key={rowIndex}>
      <div className="cpt-cell cpt-name">{name}</div>
      {quantities[rowIndex].map((quantity, columnIndex) => <div key={columnIndex} className="cpt-cell cpt-qty">{quantity || ''}</div>)}
    </Fragment>)}

    <div className="cpt-cell cpt-corner cpt-foot-corner">المجموع</div>
    {totals.map((total, columnIndex) => <div key={`t-${columnIndex}`} className="cpt-cell cpt-qty cpt-total">{total || ''}</div>)}
    {isThursday && <>
      <div className="cpt-cell cpt-corner cpt-foot-corner">المجموع المضاعف</div>
      {totals.map((total, columnIndex) => <div key={`t2-${columnIndex}`} className="cpt-cell cpt-qty cpt-total">{total ? total * 2 : ''}</div>)}
    </>}
  </div>
})

export default ChartPrintTemplate
