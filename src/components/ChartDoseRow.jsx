import { memo } from 'react'

// The dominant render cost in the chart is here: 41 of these x 51 cells each. Every prop is
// either a primitive or an array that keeps its old reference for a row untouched by the
// current edit (see updateQuantity/setPatientName in App) — so typing in one row leaves the
// other 40 with the exact same props they had last render, and memo skips them instead of
// rebuilding the whole grid on every keystroke.
// activeColumn is now live for every row (for the col-active band), so moving between
// columns re-renders all 41 rows once. Keystrokes don't touch it, so the hot path is
// unchanged. ponytail: if column nav ever feels heavy, drop the band and keep the header tint.
const ChartDoseRow = memo(function ChartDoseRow({ rowIndex, patientName, quantities, columnMedicines, isActiveRow, activeColumn, labelBelow, onUpdateQuantity }) {
  const activeMedicineName = isActiveRow && activeColumn >= 0 ? columnMedicines[activeColumn]?.trim() : ''
  return <tr data-row={rowIndex} className={isActiveRow ? 'active-row' : undefined}>{quantities.map((quantity, columnIndex) => {
    const isActiveCell = isActiveRow && activeColumn === columnIndex
    // cell-active = the one focused cell; col-active = the rest of that medicine's column
    return <td key={columnIndex} data-col={columnIndex} className={isActiveCell ? 'cell-active' : activeColumn === columnIndex ? 'col-active' : undefined}>
      <input inputMode="numeric" pattern="[0-9]*" value={quantity} onChange={(event) => onUpdateQuantity(rowIndex, columnIndex, event.target.value)} aria-label={`الكمية — ${patientName.trim() || `مريض ${rowIndex + 1}`} — ${columnMedicines[columnIndex].trim() || `دواء ${columnIndex + 1}`}`} />
      {isActiveCell && activeMedicineName && <span className={labelBelow ? 'cell-medicine below' : 'cell-medicine'}>{activeMedicineName}</span>}
    </td>
  })}</tr>
})

export default ChartDoseRow
