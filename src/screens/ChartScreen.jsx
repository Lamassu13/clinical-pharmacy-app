import { useRef } from 'react'
import hospitalLogo from '../assets/hospital-logo.png'
import ChartDoseRow from '../components/ChartDoseRow.jsx'
import { CHART_COLUMNS } from '../constants.js'

// Presentational only: every piece of chart state, and the autosave/conflict/draft logic
// that maintains it, stays in App so that swapping in the sign-in card when a session
// lapses does not unmount the half-typed chart.
export default function ChartScreen({
  selected, wardLabel, today, todayWeekday, isManager, dateIsToday, onBack, onGoToPills, onExportPdf,
  chartSaveStatus, loadError, copyError, chartReady, chartConflict, onUndoMerge, onDismissConflict,
  medicines, patientNames, columnMedicines, quantities, totals, isThursday,
  activeRow, activeColumn, labelBelow, setActiveRow, setActiveColumn, setLabelBelow,
  onSetColumnMedicine, onCommitColumnMedicine, columnMedicineNotice,
  onSetPatientName, onUpdateQuantity, onCollapseRow,
  chartFrameRef, chartHeadRef, chartGridRef, chartDosesRef, chartFootRef,
  showMedicineForm, onOpenMedicineForm, onCloseMedicineForm, onAddMedicine,
  newMedicine, setNewMedicine, registrationsError,
}) {
  const columnFocusValue = useRef('')

  // One line, four states — see chartSaveStatus in App. loadError / copyError override it
  // because a chart that never loaded or a copy that failed matters more than the last PUT.
  const saveText = loadError ? '⚠ تعذر تحميل الجارت — إعادة المحاولة…'
    : copyError ? '⚠ تعذر نسخ الجارت إلى اليوم التالي'
    : chartSaveStatus === 'error' ? '⚠ لم يُحفظ — تُعاد المحاولة…'
    : chartSaveStatus === 'saving' ? '⟳ جارٍ الحفظ…'
    : chartSaveStatus === 'pending' ? '○ لم يُحفظ بعد…'
    : '● محفوظ'
  const saveClass = (loadError || copyError || chartSaveStatus === 'error') ? 'save-state save-state-error'
    : chartSaveStatus === 'saving' ? 'save-state save-state-saving'
    : chartSaveStatus === 'pending' ? 'save-state save-state-pending'
    : 'save-state'

  return <section className="chart-page">
    <div className="chart-toolbar">
      <button className="back-button" onClick={onBack}>→ العودة للردهات</button>
      <div><h1>{wardLabel}</h1></div>
      <div className="toolbar-actions">
        {isManager && <button className="secondary-button compact" onClick={onOpenMedicineForm}>+ علاج جديد</button>}
        <button className="primary-button compact" onClick={onExportPdf}>طباعة A4 / PDF</button>
        <button className="secondary-button compact go-pills" onClick={onGoToPills}>استمارة الحبوب ←</button>
      </div>
    </div>

    <div className="chart-meta">
      {selected.floor && <span>الطابق: <b>{selected.floor}</b></span>}
      <span>الفرع: <b>{selected.ward}</b></span>
      <span>التاريخ: <b>{today}</b> — <b>{todayWeekday}</b></span>
      {!dateIsToday && <span className="date-warning">⚠ لست على تاريخ اليوم</span>}
      <span aria-live="polite" className={saveClass}>{saveText}</span>
    </div>

    {chartConflict && <div className="chart-conflict" role="alert">
      <div className="chart-conflict-head">
        <strong>⟳ دُمجت تعديلات من جهاز آخر</strong>
        <span>{chartConflict.changes.length} حقلًا تغيّرت قيمته — راجعها</span>
      </div>
      <ul className="chart-conflict-list">
        {chartConflict.changes.slice(0, 12).map((change, index) => <li key={index}>
          {change.what}: <b>{change.from}</b> ← <b>{change.to}</b>
        </li>)}
        {chartConflict.changes.length > 12 && <li>…و{chartConflict.changes.length - 12} حقلًا آخر</li>}
      </ul>
      <div className="chart-conflict-actions">
        <button type="button" className="secondary-button compact" onClick={onUndoMerge}>تراجع عن الدمج</button>
        <button type="button" className="primary-button compact" onClick={onDismissConflict}>حسنًا، راجعت</button>
      </div>
    </div>}

    {columnMedicineNotice && <p className="form-error chart-medicine-notice" role="alert">{columnMedicineNotice}</p>}
    <datalist id="medicine-options">{medicines.map((medicine) => <option key={medicine} value={medicine} />)}</datalist>

    <div className="active-patient-bar" aria-live="polite">{activeRow >= 0
      ? <><span className="bar-item"><span className="bar-key">المريض</span><strong>{patientNames[activeRow]?.trim() || 'بلا اسم'}</strong><span className="bar-num">صف {activeRow + 1}</span></span>{activeColumn >= 0 && <span className="bar-item"><span className="bar-key">العلاج</span><strong>{columnMedicines[activeColumn]?.trim() || 'بلا اسم'}</strong><span className="bar-num">عمود {activeColumn + 1}</span></span>}</>
      : <span className="muted">اضغط داخل خلية ليظهر المريض والعلاج هنا</span>}</div>

    <div className="chart-frame" ref={chartFrameRef}>
      {!chartReady && <div className="chart-frame-loading" role="status">{loadError ? 'تعذر تحميل الجارت — إعادة المحاولة…' : 'جارٍ تحميل الجارت…'}</div>}
      <div className="chart-head" inert={!chartReady || undefined}>
        <div className="chart-head-corner"><img className="patient-header-logo" src={hospitalLogo} alt="" /><span>مستشفى بغداد التعليمي</span><span>وحدة الصيدلة السريرية</span>{selected.floor && <span>الطابق {selected.floor}</span>}<span>{selected.ward}</span><span>{today}</span><span>{todayWeekday}</span></div>
        <div className="chart-head-scroll" ref={chartHeadRef}><table className="chart-table"><thead><tr>{Array.from({ length: CHART_COLUMNS }, (_, index) => <th key={index}><input className="medicine-select" list="medicine-options" value={columnMedicines[index]} onChange={(event) => onSetColumnMedicine(index, event.target.value)} onFocus={(event) => { columnFocusValue.current = event.target.value }} onBlur={(event) => onCommitColumnMedicine(index, event.target.value, columnFocusValue.current)} placeholder="دواء" title="اكتب أول حروف الدواء واختر من القائمة" aria-label={`اسم الدواء، عمود ${index + 1}`} /></th>)}</tr></thead></table></div>
      </div>
      <div className="chart-grid" ref={chartGridRef} inert={!chartReady || undefined}
        onFocusCapture={(event) => { const row = event.target.closest('tr[data-row]'); if (row) setActiveRow(Number(row.dataset.row)); const cell = event.target.closest('td[data-col]'); setActiveColumn(cell ? Number(cell.dataset.col) : -1); if (cell && chartGridRef.current) setLabelBelow(cell.getBoundingClientRect().top - chartGridRef.current.getBoundingClientRect().top < 34) }}
        onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) { setActiveRow(-1); setActiveColumn(-1) } }}>
        <div className="chart-names"><table className="chart-table"><tbody>{patientNames.map((name, rowIndex) => <tr key={rowIndex} data-row={rowIndex} className={activeRow === rowIndex ? 'active-row' : undefined}>
          <th className="patient-cell">
            <input value={name} onChange={(event) => onSetPatientName(rowIndex, event.target.value)} placeholder={`مريض ${rowIndex + 1}`} aria-label={`اسم المريض، صف ${rowIndex + 1}`} />
            {activeRow === rowIndex && name.trim() && <button type="button" className="row-delete" aria-label={`حذف صف ${rowIndex + 1}`} title="حذف الصف" onPointerDown={(event) => event.preventDefault()} onMouseDown={(event) => event.preventDefault()} onClick={() => onCollapseRow(rowIndex)}>✕</button>}
          </th>
        </tr>)}</tbody></table></div>
        <div className="chart-doses" ref={chartDosesRef}><table className="chart-table"><tbody>{patientNames.map((name, rowIndex) => <ChartDoseRow key={rowIndex} rowIndex={rowIndex} patientName={name} quantities={quantities[rowIndex]} columnMedicines={columnMedicines} isActiveRow={activeRow === rowIndex} activeColumn={activeRow === rowIndex ? activeColumn : -1} labelBelow={labelBelow} onUpdateQuantity={onUpdateQuantity} />)}</tbody></table></div>
      </div>
      <div className="chart-foot">
        <div className="chart-foot-corner"><span>المجموع</span>{isThursday && <span>المجموع المضاعف</span>}</div>
        <div className="chart-foot-scroll" ref={chartFootRef}><table className="chart-table"><tfoot><tr>{totals.map((total, index) => <td key={index}>{total || ''}</td>)}</tr>{isThursday && <tr className="doubled-row">{totals.map((total, index) => <td key={index}>{total ? total * 2 : ''}</td>)}</tr>}</tfoot></table></div>
      </div>
    </div>

    {showMedicineForm && <div className="modal-backdrop" onClick={onCloseMedicineForm}><form className="medicine-modal" role="dialog" aria-modal="true" aria-labelledby="add-medicine-title" onSubmit={onAddMedicine} onClick={(event) => event.stopPropagation()}><button type="button" className="close-button" aria-label="إغلاق" onClick={onCloseMedicineForm}>×</button><p className="modal-kicker">قائمة الأدوية العامة</p><h2 id="add-medicine-title">إضافة علاج جديد</h2>{registrationsError && <p className="form-error" role="alert">{registrationsError}</p>}<label>اسم العلاج<input autoFocus value={newMedicine} onChange={(event) => setNewMedicine(event.target.value)} required /></label><button className="primary-button" type="submit">إضافة إلى القائمة</button></form></div>}
  </section>
}
