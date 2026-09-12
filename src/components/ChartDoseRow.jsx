import { memo } from 'react'

// The dominant render cost in the chart is here: 41 of these x 51 cells each. Every prop is
// either a primitive or an array that keeps its old reference for a row untouched by the
// current edit (see updateQuantity/setPatientName in App) — so typing in one row leaves the
// other 40 with the exact same props they had last render, and memo skips them instead of
// rebuilding the whole grid on every keystroke.
// activeColumn is now live for every row (for the col-active band), so moving between
// columns re-renders all 41 rows once. Keystrokes don't touch it, so the hot path is
// unchanged. ponytail: if column nav ever feels heavy, drop the band and keep the header tint.
// gridInactive flips only when focus enters/leaves the grid, so it costs one re-render pass.
const ChartDoseRow = memo(function ChartDoseRow({ rowIndex, patientName, quantities, columnMedicines, isActiveRow, activeColumn, gridInactive, labelBelow, droppedCells, onUpdateQuantity, printHidden }) {
  const activeMedicineName = isActiveRow && activeColumn >= 0 ? columnMedicines[activeColumn]?.trim() : ''
  return <tr data-row={rowIndex} role="row" aria-rowindex={rowIndex + 1} className={[isActiveRow && 'active-row', printHidden && 'print-hide-row'].filter(Boolean).join(' ') || undefined}>{quantities.map((quantity, columnIndex) => {
    const isActiveCell = isActiveRow && activeColumn === columnIndex
    // After a stale-lock merge, the other device's value for a cell this tab overwrote — shown
    // until the pharmacist edits the cell (App's updateQuantity clears it).
    const droppedValue = droppedCells && droppedCells[`${rowIndex}:${columnIndex}`]
    // Roving tabindex: the 2000+ dose cells are a single Tab stop — arrows / Enter move
    // between them (keydown handler on .chart-grid). Tabbable target is the focused cell;
    // failing that, this row's first cell when the row is active but no column is; failing
    // that, the top-right cell (row 0, col 0 in this RTL grid) before anything is focused.
    const roving = isActiveRow
      ? (activeColumn < 0 ? columnIndex === 0 : activeColumn === columnIndex)
      : (gridInactive && rowIndex === 0 && columnIndex === 0)
    // cell-active = the one focused cell; col-active = the rest of that medicine's column
    return <td key={columnIndex} data-col={columnIndex} role="gridcell" aria-colindex={columnIndex + 1} className={isActiveCell ? 'cell-active' : activeColumn === columnIndex ? 'col-active' : undefined}>
      <input inputMode="numeric" pattern="[0-9]*" maxLength={4} tabIndex={roving ? 0 : -1} value={quantity} onChange={(event) => onUpdateQuantity(rowIndex, columnIndex, event.target.value)} aria-label={`الكمية — ${patientName.trim() || `مريض ${rowIndex + 1}`} — ${columnMedicines[columnIndex].trim() || `دواء ${columnIndex + 1}`}${droppedValue ? ` — قيمة جهاز آخر: ${droppedValue}` : ''}`} />
      {isActiveCell && activeMedicineName && <span className={labelBelow ? 'cell-medicine below' : 'cell-medicine'}>{activeMedicineName}</span>}
      {droppedValue != null && droppedValue !== false && <span className="cell-was" title="قيمة الجهاز الآخر — عدّل الخلية لتثبيت قيمتك">كان: {droppedValue}</span>}
    </td>
  })}</tr>
})

export default ChartDoseRow
