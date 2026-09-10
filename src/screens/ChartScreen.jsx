import { useRef } from 'react'
import hospitalLogo from '../assets/hospital-logo.png'
import ChartDoseRow from '../components/ChartDoseRow.jsx'
import { CHART_COLUMNS } from '../constants.js'

// Presentational only: every piece of chart state, and the autosave/lock/draft logic that
// maintains it, stays in App so that swapping in the sign-in card when a session lapses does
// not unmount the half-typed chart.
export default function ChartScreen({
  selected, wardLabel, today, todayWeekday, isManager, dateIsToday, selectedDate, onChangeDate, onCopyToNextDay, onBack, onGoToPills, onExportPdf,
  chartSaveStatus, loadError, copyError, chartReady, lastChartSaveAt, onRetryLoad, onRetrySave, lockState, lockHolder,
  chartClashNote, onDismissClashNote, droppedCells, undo, onUndo,
  medicines, patientNames, columnMedicines, quantities, totals, isThursday,
  activeRow, activeColumn, labelBelow, setActiveRow, setActiveColumn, setLabelBelow,
  onSetColumnMedicine, onCommitColumnMedicine, columnMedicineNotice, onDismissNotice, onApplySuggestion,
  onSetPatientName, onUpdateQuantity, onCollapseRow,
  chartFrameRef, chartHeadRef, chartGridRef, chartDosesRef, chartFootRef,
  showMedicineForm, onOpenMedicineForm, onCloseMedicineForm, onAddMedicine,
  newMedicine, setNewMedicine, registrationsError,
}) {
  const columnFocusValue = useRef('')

  // One line, four states — see chartSaveStatus in App. loadError overrides it because a
  // chart that never loaded matters more than the last PUT; copyError gets its own slot
  // below so a failed copy never hides whether live edits are still saving.
  const savedTime = lastChartSaveAt
    ? new Date(lastChartSaveAt).toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' })
    : ''
  const saveText = loadError ? '⚠ تعذر تحميل الجارت'
    : chartSaveStatus === 'error' ? '⚠ لم يُحفظ'
    : chartSaveStatus === 'saving' ? '⟳ جارٍ الحفظ…'
    : chartSaveStatus === 'pending' ? '○ لم يُحفظ بعد…'
    : savedTime ? `● محفوظ · آخر حفظ ${savedTime}`
    : '● محفوظ'
  const saveClass = (loadError || chartSaveStatus === 'error') ? 'save-state save-state-error'
    : chartSaveStatus === 'saving' ? 'save-state save-state-saving'
    : chartSaveStatus === 'pending' ? 'save-state save-state-pending'
    : 'save-state'

  // Another device holds the edit lock: the grid goes inert (below) and the view polls the
  // holder's edits in. The toolbar/meta/status bars stay readable — an SR user still needs the
  // ward name, date and save state during read-only. read = true only while it's someone else's.
  const readOnly = lockState === 'readonly'
  const hasDropped = droppedCells && Object.keys(droppedCells).length > 0
  const frameClass = ['chart-frame', readOnly && 'chart-frame-held', hasDropped && 'chart-frame--clash'].filter(Boolean).join(' ')
  const since = lockHolder?.since
    ? new Date(lockHolder.since).toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' })
    : ''

  return <section className="chart-page">
    {readOnly && <div className="chart-lock-banner chart-lock-banner--held" role="status">
      قيد التعديل — {lockHolder?.name || 'جهاز آخر'}{since && ` · منذ ${since}`}
    </div>}
    {lockState === 'available' && <div className="chart-lock-banner chart-lock-banner--free" role="status">
      الجارت متاح الآن — المس أي خلية للبدء
    </div>}
    {lockState === 'stale' && <div className="chart-lock-banner chart-lock-banner--stale" role="status">
      تعذّر تجديد القفل — قد يفتحه جهاز آخر. تعديلاتك محفوظة على هذا الجهاز.
    </div>}

    <div className="chart-toolbar">
      <button className="back-button" onClick={onBack}>→ العودة للردهات</button>
      <div><h1>{wardLabel}</h1></div>
      <div className="toolbar-actions">
        {isManager && !readOnly && <button className="secondary-button compact" onClick={onOpenMedicineForm}>+ علاج جديد</button>}
        <button className="primary-button compact" onClick={onExportPdf}>طباعة A4 / PDF</button>
        <button className="secondary-button compact go-pills" onClick={onGoToPills}>استمارة الحبوب ←</button>
      </div>
    </div>

    <div className="chart-meta">
      {selected.slot === 'extra' && <span className="chart-slot-flag">جارت إضافي</span>}
      {lockState === 'editing' && <span className="chart-lock-mark">أنت تُحرّر</span>}
      {selected.floor && <span>الطابق: <b>{selected.floor}</b></span>}
      <span>الفرع: <b>{selected.ward}</b></span>
      <span>التاريخ: <b>{today}</b> — <b>{todayWeekday}</b></span>
      <span className="date-controls">
        <label>التاريخ <input type="date" aria-label="تاريخ الجارت" value={selectedDate} onChange={(event) => onChangeDate(event.target.value)} /></label>
        {!readOnly && <button type="button" onClick={onCopyToNextDay}>نسخ إلى اليوم التالي</button>}
      </span>
    </div>

    <datalist id="medicine-options">{medicines.map((medicine) => <option key={medicine} value={medicine} />)}</datalist>

    {/* The only strip that stays put while the grid scrolls, so the status that matters at a
        hand-off — is it saved, is this today's chart — rides here, not in the scrolling meta row.
        Fixed height, and no other content flows into it: the recovery / clash lines render
        below the grid (.chart-recover-line, .chart-clash-note) so the grid never shifts under
        a finger. The save chip is aria-live polite (announces "saved" at a pause on hand-off);
        .chart-recover-line (role=alert) is what interrupts for a failure. */}
    <div className="active-patient-bar">
      <div className="bar-focus">{activeRow >= 0
        ? <><span className="bar-item"><span className="bar-key">المريض</span><strong>{patientNames[activeRow]?.trim() || 'بلا اسم'}</strong><span className="bar-num">صف {activeRow + 1}</span></span>{activeColumn >= 0 && <span className="bar-item"><span className="bar-key">العلاج</span><strong>{columnMedicines[activeColumn]?.trim() || 'بلا اسم'}</strong><span className="bar-num">عمود {activeColumn + 1}</span></span>}</>
        : <span className="muted">اضغط داخل خلية ليظهر المريض والعلاج هنا</span>}</div>
      {!dateIsToday && <span className="bar-date-warning">⚠ جارت {today} — ليس اليوم</span>}
      {chartReady && <span className={saveClass} aria-live="polite">{saveText}</span>}
    </div>

    {/* Held until the next valid commit or an explicit dismiss — no auto-timeout, since on a
        shared iPad the pharmacist usually looks up before a self-clearing notice can be read. */}
    {columnMedicineNotice && <p className="form-error chart-medicine-notice" role="alert">
      <span>
        {columnMedicineNotice.text}{' '}
        {columnMedicineNotice.suggestion
          ? <>هل تقصد <button type="button" className="notice-suggest" onClick={() => onApplySuggestion(columnMedicineNotice.column, columnMedicineNotice.suggestion)}>«{columnMedicineNotice.suggestion}»</button>؟</>
          : isManager ? 'أضِف الدواء أولًا من «إدارة الأدوية».' : 'اطلب من المشرف إضافته إلى القائمة.'}
      </span>
      <button type="button" className="notice-dismiss" aria-label="إخفاء التنبيه" onClick={onDismissNotice}>×</button>
    </p>}

    {/* chart-frame-held draws a desaturating scrim over the grid while another device is
        editing — reads as "held" without dimming the dose numbers themselves (opacity did). */}
    <div className={frameClass} ref={chartFrameRef}>
      {!chartReady && <div className="chart-frame-loading" role="status">
        {loadError
          ? <><span>تعذّر تحميل الجارت. تُعاد المحاولة تلقائيًا كل بضع ثوانٍ.</span><button type="button" className="secondary-button compact" onClick={onRetryLoad}>إعادة المحاولة الآن</button></>
          : <span>جارٍ تحميل الجارت…</span>}
      </div>}
      {/* A blank 41×51 grid on a new chart otherwise looks the same as a dismissed failed load.
          Floats over the empty grid and clears the instant anything is typed — no layout shift. */}
      {chartReady && !readOnly && patientNames.every((name) => !name.trim()) && columnMedicines.every((medicine) => !medicine.trim()) && (
        <p className="chart-empty-hint">جارت جديد — اكتب اسم أول مريض في أقصى اليمين، ثم اسم الدواء في رأس العمود.</p>
      )}
      <div className="chart-head" inert={(!chartReady || readOnly) || undefined}>
        <div className="chart-head-corner"><img className="patient-header-logo" src={hospitalLogo} alt="" /><span>مستشفى بغداد التعليمي</span><span>وحدة الصيدلة السريرية</span>{selected.floor && <span>الطابق {selected.floor}</span>}<span>{selected.ward}</span><span>{today}</span><span>{todayWeekday}</span></div>
        <div className="chart-head-scroll" ref={chartHeadRef}><table className="chart-table" role="presentation"><thead><tr>{Array.from({ length: CHART_COLUMNS }, (_, index) => <th key={index} className={activeColumn === index ? 'col-active' : undefined}><input className="medicine-select" list="medicine-options" value={columnMedicines[index]} onChange={(event) => onSetColumnMedicine(index, event.target.value)} onFocus={(event) => { columnFocusValue.current = event.target.value; setActiveColumn(index) }} onBlur={(event) => onCommitColumnMedicine(index, event.target.value, columnFocusValue.current)} placeholder="دواء" title="اكتب أول حروف الدواء واختر من القائمة" aria-label={`اسم الدواء، عمود ${index + 1}`} /></th>)}</tr></thead></table></div>
      </div>
      {/* inert while another device holds the lock — the poll keeps this view current. */}
      <div className="chart-grid" ref={chartGridRef} inert={(!chartReady || readOnly) || undefined}
        onFocusCapture={(event) => { const row = event.target.closest('tr[data-row]'); if (row) setActiveRow(Number(row.dataset.row)); const cell = event.target.closest('td[data-col]'); setActiveColumn(cell ? Number(cell.dataset.col) : -1); if (cell && chartGridRef.current) setLabelBelow(cell.getBoundingClientRect().top - chartGridRef.current.getBoundingClientRect().top < 34) }}
        onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) { setActiveRow(-1); setActiveColumn(-1) } }}
        onKeyDown={(event) => {
          // Arrow / Enter move between dose cells (the grid is one Tab stop). RTL: ArrowLeft
          // is visually left = the next, higher-index column. Left/Right take over from
          // in-cell caret movement, which a 4-digit-capped quantity field does not need.
          const step = { ArrowUp: [-1, 0], ArrowDown: [1, 0], Enter: [1, 0], ArrowLeft: [0, 1], ArrowRight: [0, -1] }[event.key]
          if (!step) return
          const td = event.target.closest('td[data-col]')
          const tr = event.target.closest('tr[data-row]')
          if (!td || !tr) return
          const row = Math.min(patientNames.length - 1, Math.max(0, Number(tr.dataset.row) + step[0]))
          const col = Math.min(CHART_COLUMNS - 1, Math.max(0, Number(td.dataset.col) + step[1]))
          const next = chartDosesRef.current?.querySelector(`tr[data-row="${row}"] td[data-col="${col}"] input`)
          if (next) { event.preventDefault(); next.focus(); next.select() }
        }}>
        <div className="chart-names"><table className="chart-table" role="presentation"><tbody>{patientNames.map((name, rowIndex) => <tr key={rowIndex} data-row={rowIndex} className={activeRow === rowIndex ? 'active-row' : undefined}>
          <th className="patient-cell">
            <input value={name} onChange={(event) => onSetPatientName(rowIndex, event.target.value)} placeholder={`مريض ${rowIndex + 1}`} aria-label={`اسم المريض، صف ${rowIndex + 1}`} />
            {activeRow === rowIndex && name.trim() && <button type="button" className="row-delete" aria-label={`حذف صف ${rowIndex + 1}`} title="حذف الصف" onPointerDown={(event) => event.preventDefault()} onMouseDown={(event) => event.preventDefault()} onClick={() => onCollapseRow(rowIndex)}>✕</button>}
          </th>
        </tr>)}</tbody></table></div>
        <div className="chart-doses" ref={chartDosesRef}><table className="chart-table" role="grid" aria-label="جدول الجرعات — الأسهم للتنقّل بين الخلايا" aria-rowcount={patientNames.length} aria-colcount={CHART_COLUMNS}>{/* one grid; each cell's aria-label already carries its patient + medicine */}<tbody>{patientNames.map((name, rowIndex) => <ChartDoseRow key={rowIndex} rowIndex={rowIndex} patientName={name} quantities={quantities[rowIndex]} columnMedicines={columnMedicines} isActiveRow={activeRow === rowIndex} activeColumn={activeColumn} gridInactive={activeRow < 0} labelBelow={labelBelow} droppedCells={droppedCells} onUpdateQuantity={onUpdateQuantity} />)}</tbody></table></div>
      </div>
      <div className="chart-foot">
        <div className="chart-foot-corner"><span>المجموع</span>{isThursday && <span>المجموع المضاعف</span>}</div>
        <div className="chart-foot-scroll" ref={chartFootRef}><table className="chart-table" role="presentation"><tfoot><tr>{totals.map((total, index) => <td key={index}>{total || ''}</td>)}</tr>{isThursday && <tr className="doubled-row">{totals.map((total, index) => <td key={index}>{total ? total * 2 : ''}</td>)}</tr>}</tfoot></table></div>
      </div>
    </div>

    {/* Below the grid, so a save failure or a merge outcome never pushes the cells the
        pharmacist is typing into. */}
    {chartReady && (chartSaveStatus === 'error' || copyError) && <div className="chart-recover-line" role="alert">
      {chartSaveStatus === 'error' && <>
        <span>لم يُحفظ — تُعاد المحاولة تلقائيًا. تعديلاتك محفوظة على هذا الجهاز.</span>
        <button type="button" className="secondary-button compact" onClick={onRetrySave}>إعادة المحاولة الآن</button>
      </>}
      {copyError && <span>تعذّر نسخ الجارت — أعِد الضغط على «نسخ إلى اليوم التالي».</span>}
    </div>}

    {chartClashNote && <div className="chart-clash-note" role="status">
      <span>{chartClashNote}</span>
      <button type="button" className="text-button compact" aria-label="إخفاء" onClick={onDismissClashNote}>حسنًا</button>
    </div>}

    {undo && <div className="undo-toast" role="status">
      <span>{undo.message}</span>
      <button type="button" className="text-button compact" onClick={onUndo}>تراجع</button>
    </div>}

    {showMedicineForm && <div className="modal-backdrop" onClick={onCloseMedicineForm}><form className="medicine-modal" role="dialog" aria-modal="true" aria-labelledby="add-medicine-title" onSubmit={onAddMedicine} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
      if (event.key !== 'Tab') return
      const f = event.currentTarget.querySelectorAll('button, input')
      const edge = event.shiftKey ? f[0] : f[f.length - 1]
      if (document.activeElement === edge) { event.preventDefault(); (event.shiftKey ? f[f.length - 1] : f[0]).focus() }
    }}><button type="button" className="close-button" aria-label="إغلاق" onClick={onCloseMedicineForm}>×</button><p className="modal-kicker">قائمة الأدوية العامة</p><h2 id="add-medicine-title">إضافة علاج جديد</h2>{registrationsError && <p className="form-error" role="alert">{registrationsError}</p>}<label>اسم العلاج<input autoFocus value={newMedicine} onChange={(event) => setNewMedicine(event.target.value)} required /></label><button className="primary-button" type="submit">إضافة إلى القائمة</button></form></div>}
  </section>
}
