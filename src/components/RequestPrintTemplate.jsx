import { forwardRef } from 'react'
import { SHEETS_PER_CANVAS } from '../usePdfSheets.js'
import MeropenemSheet from './MeropenemSheet.jsx'
import AlbuminSheet from './AlbuminSheet.jsx'
import TigecyclineSheet from './TigecyclineSheet.jsx'
import ColistinSheet from './ColistinSheet.jsx'

// The request forms as paper, drawn off-screen for usePdfSheets: one fixed A4 portrait .rpt-sheet per
// form, the sheet component in its `paper` mode (plain text, ✓ only on ticked boxes). A PDF page is
// the same on every device, where the browser's print engine was not: Safari on iPad ignores the
// named portrait page and printed the Meropenem form landscape, over two pages.
// sheets: [{ key, kind, request, wardName, wardLabel }]
const SHEETS = { meropenem: MeropenemSheet, albumin: AlbuminSheet, tigecycline: TigecyclineSheet, colistin: ColistinSheet }

const RequestPrintTemplate = forwardRef(function RequestPrintTemplate({ sheets }, ref) {
  const chunks = Array.from({ length: Math.ceil(sheets.length / SHEETS_PER_CANVAS) }, (_, index) => sheets.slice(index * SHEETS_PER_CANVAS, (index + 1) * SHEETS_PER_CANVAS))
  return <div ref={ref} className="ppt-root">{chunks.map((chunk) => <div key={chunk[0].key} className="ppt-chunk">{chunk.map((sheet) => {
    const Sheet = SHEETS[sheet.kind]
    return <section key={sheet.key} className={`rpt-sheet rpt-sheet--${sheet.kind}`}>
      <Sheet paper request={sheet.request} wardName={sheet.wardName} wardLabel={sheet.wardLabel} />
    </section>
  })}</div>)}</div>
})

export default RequestPrintTemplate
