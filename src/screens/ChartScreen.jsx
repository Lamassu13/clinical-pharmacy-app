import { useEffect, useRef, useState } from 'react'
import hospitalLogo from '../assets/hospital-logo.png'
import ChartDoseRow from '../components/ChartDoseRow.jsx'
import { CHART_COLUMNS } from '../constants.js'

// Presentational only: every piece of chart state, and the autosave/conflict/draft logic
// that maintains it, stays in App so that swapping in the sign-in card when a session
// lapses does not unmount the half-typed chart.
export default function ChartScreen({
  selected, wardLabel, today, todayWeekday, isManager, dateIsToday, onBack, onGoToPills, onExportPdf,
  chartSaveStatus, loadError, copyError, chartReady, chartConflict, onResolveConflict,
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
  const saveText = loadError ? '⚠ تعذر تحميل الجارت — إعادة المحاولة…'
    : chartSaveStatus === 'error' ? '⚠ لم يُحفظ — تُعاد المحاولة…'
    : chartSaveStatus === 'saving' ? '⟳ جارٍ الحفظ…'
    : chartSaveStatus === 'pending' ? '○ لم يُحفظ بعد…'
    : '● محفوظ'
  const saveClass = (loadError || chartSaveStatus === 'error') ? 'save-state save-state-error'
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
    </div>

    <datalist id="medicine-options">{medicines.map((medicine) => <option key={medicine} value={medicine} />)}</datalist>

    {/* The only strip that stays put while the grid scrolls, so the status that matters at a
        hand-off — is it saved, is this today's chart — rides here, not in the scrolling meta row. */}
    <div className="active-patient-bar">
      <div className="bar-focus" aria-live="polite">{activeRow >= 0
        ? <><span className="bar-item"><span className="bar-key">المريض</span><strong>{patientNames[activeRow]?.trim() || 'بلا اسم'}</strong><span className="bar-num">صف {activeRow + 1}</span></span>{activeColumn >= 0 && <span className="bar-item"><span className="bar-key">العلاج</span><strong>{columnMedicines[activeColumn]?.trim() || 'بلا اسم'}</strong><span className="bar-num">عمود {activeColumn + 1}</span></span>}</>
        : <span className="muted">اضغط داخل خلية ليظهر المريض والعلاج هنا</span>}</div>
      {!dateIsToday && <span className="bar-date-warning">⚠ جارت {today} — ليس اليوم</span>}
      {copyError && <span className="save-state save-state-error" role="alert">⚠ تعذّر نسخ الجارت</span>}
      {/* No save chip until the chart has loaded — the default is "saved", which would be a
          lie over a grid that has not arrived yet (the loading cover is showing meanwhile). */}
      {chartReady && <span aria-live="polite" className={saveClass}>{saveText}</span>}
    </div>

    {chartConflict && <ConflictPanel conflict={chartConflict} onResolve={onResolveConflict} />}

    {/* One notice at a time: a merge to review outranks a mistyped column header. Held until
        the next valid commit or an explicit dismiss — no auto-timeout, since on a shared iPad
        the pharmacist usually looks up before a self-clearing notice can be read. */}
    {!chartConflict && columnMedicineNotice && <p className="form-error chart-medicine-notice" role="alert">
      <span>
        {columnMedicineNotice.text}{' '}
        {columnMedicineNotice.suggestion
          ? <>هل تقصد <button type="button" className="notice-suggest" onClick={() => onApplySuggestion(columnMedicineNotice.column, columnMedicineNotice.suggestion)}>«{columnMedicineNotice.suggestion}»</button>؟</>
          : isManager ? 'أضِف الدواء أولًا من «إدارة الأدوية».' : 'اطلب من المشرف إضافته إلى القائمة.'}
      </span>
      <button type="button" className="notice-dismiss" aria-label="إخفاء التنبيه" onClick={onDismissNotice}>×</button>
    </p>}

    <div className="chart-frame" ref={chartFrameRef}>
      {!chartReady && <div className="chart-frame-loading" role="status">{loadError ? 'تعذر تحميل الجارت — إعادة المحاولة…' : 'جارٍ تحميل الجارت…'}</div>}
      <div className="chart-head" inert={(!chartReady || Boolean(chartConflict)) || undefined}>
        <div className="chart-head-corner"><img className="patient-header-logo" src={hospitalLogo} alt="" /><span>مستشفى بغداد التعليمي</span><span>وحدة الصيدلة السريرية</span>{selected.floor && <span>الطابق {selected.floor}</span>}<span>{selected.ward}</span><span>{today}</span><span>{todayWeekday}</span></div>
        <div className="chart-head-scroll" ref={chartHeadRef}><table className="chart-table"><thead><tr>{Array.from({ length: CHART_COLUMNS }, (_, index) => <th key={index} className={activeColumn === index ? 'col-active' : undefined}><input className="medicine-select" list="medicine-options" value={columnMedicines[index]} onChange={(event) => onSetColumnMedicine(index, event.target.value)} onFocus={(event) => { columnFocusValue.current = event.target.value; setActiveColumn(index) }} onBlur={(event) => onCommitColumnMedicine(index, event.target.value, columnFocusValue.current)} placeholder="دواء" title="اكتب أول حروف الدواء واختر من القائمة" aria-label={`اسم الدواء، عمود ${index + 1}`} /></th>)}</tr></thead></table></div>
      </div>
      {/* inert while a merge is under review too: forces resolve-then-resume, and stops the
          pharmacist editing a conflicted cell whose pre-merge value the panel still holds. */}
      <div className="chart-grid" ref={chartGridRef} inert={(!chartReady || Boolean(chartConflict)) || undefined}
        onFocusCapture={(event) => { const row = event.target.closest('tr[data-row]'); if (row) setActiveRow(Number(row.dataset.row)); const cell = event.target.closest('td[data-col]'); setActiveColumn(cell ? Number(cell.dataset.col) : -1); if (cell && chartGridRef.current) setLabelBelow(cell.getBoundingClientRect().top - chartGridRef.current.getBoundingClientRect().top < 34) }}
        onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) { setActiveRow(-1); setActiveColumn(-1) } }}
        onKeyDown={(event) => {
          // Arrow / Enter move between dose cells (the grid is one Tab stop). RTL: ArrowLeft
          // is visually left = the next, higher-index column. Left/Right take over from
          // in-cell caret movement, which a 3-digit-max quantity field does not need.
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
        <div className="chart-names"><table className="chart-table"><tbody>{patientNames.map((name, rowIndex) => <tr key={rowIndex} data-row={rowIndex} className={activeRow === rowIndex ? 'active-row' : undefined}>
          <th className="patient-cell">
            <input value={name} onChange={(event) => onSetPatientName(rowIndex, event.target.value)} placeholder={`مريض ${rowIndex + 1}`} aria-label={`اسم المريض، صف ${rowIndex + 1}`} />
            {activeRow === rowIndex && name.trim() && <button type="button" className="row-delete" aria-label={`حذف صف ${rowIndex + 1}`} title="حذف الصف" onPointerDown={(event) => event.preventDefault()} onMouseDown={(event) => event.preventDefault()} onClick={() => onCollapseRow(rowIndex)}>✕</button>}
          </th>
        </tr>)}</tbody></table></div>
        <div className="chart-doses" ref={chartDosesRef}><table className="chart-table" role="grid" aria-label="جدول الجرعات — الأسهم للتنقّل بين الخلايا">{/* one grid; each cell's aria-label already carries its patient + medicine */}<tbody>{patientNames.map((name, rowIndex) => <ChartDoseRow key={rowIndex} rowIndex={rowIndex} patientName={name} quantities={quantities[rowIndex]} columnMedicines={columnMedicines} isActiveRow={activeRow === rowIndex} activeColumn={activeColumn} gridInactive={activeRow < 0} labelBelow={labelBelow} onUpdateQuantity={onUpdateQuantity} />)}</tbody></table></div>
      </div>
      <div className="chart-foot">
        <div className="chart-foot-corner"><span>المجموع</span>{isThursday && <span>المجموع المضاعف</span>}</div>
        <div className="chart-foot-scroll" ref={chartFootRef}><table className="chart-table"><tfoot><tr>{totals.map((total, index) => <td key={index}>{total || ''}</td>)}</tr>{isThursday && <tr className="doubled-row">{totals.map((total, index) => <td key={index}>{total ? total * 2 : ''}</td>)}</tr>}</tfoot></table></div>
      </div>
    </div>

    {showMedicineForm && <div className="modal-backdrop" onClick={onCloseMedicineForm}><form className="medicine-modal" role="dialog" aria-modal="true" aria-labelledby="add-medicine-title" onSubmit={onAddMedicine} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
      if (event.key !== 'Tab') return
      const f = event.currentTarget.querySelectorAll('button, input')
      const edge = event.shiftKey ? f[0] : f[f.length - 1]
      if (document.activeElement === edge) { event.preventDefault(); (event.shiftKey ? f[f.length - 1] : f[0]).focus() }
    }}><button type="button" className="close-button" aria-label="إغلاق" onClick={onCloseMedicineForm}>×</button><p className="modal-kicker">قائمة الأدوية العامة</p><h2 id="add-medicine-title">إضافة علاج جديد</h2>{registrationsError && <p className="form-error" role="alert">{registrationsError}</p>}<label>اسم العلاج<input autoFocus value={newMedicine} onChange={(event) => setNewMedicine(event.target.value)} required /></label><button className="primary-button" type="submit">إضافة إلى القائمة</button></form></div>}
  </section>
}

// The cross-device merge review. Fields are grouped by kind (doses first — the higher-stakes
// field); ticking a row keeps this tab's value, unticked accepts the other device's. A global
// and per-group "استرجع قيمتي" tick every row in scope. "تطبيق" applies the ticked reverts
// and restores focus to wherever it was. The head is role="alert" so a screen reader learns a
// merge landed without the panel stealing focus from a half-typed cell; the 30-row list is
// left for the reader to page through, not fired off in one burst.
const CONFLICT_GROUPS = [
  { kind: 'quantity', label: 'جرعات' },
  { kind: 'medicine', label: 'أدوية' },
  { kind: 'name', label: 'أسماء المرضى' },
]

function ConflictPanel({ conflict, onResolve }) {
  const [keepMine, setKeepMine] = useState(() => new Set())
  const restoreRef = useRef(null)
  // Runs for the first conflict and again if a second 409 replaces it without unmounting —
  // clears stale ticks (their indices point into the old changes array) and re-captures the
  // element to hand focus back to.
  useEffect(() => { restoreRef.current = document.activeElement; setKeepMine(new Set()) }, [conflict])

  const rows = conflict.changes.map((change, index) => ({ ...change, index }))
  const groups = CONFLICT_GROUPS
    .map((group) => ({ ...group, rows: rows.filter((row) => row.kind === group.kind) }))
    .filter((group) => group.rows.length)
  const setRows = (scope, on) => setKeepMine((current) => {
    const next = new Set(current)
    scope.forEach((row) => { if (on) next.add(row.index); else next.delete(row.index) })
    return next
  })
  const toggleOne = (index) => setKeepMine((current) => {
    const next = new Set(current)
    if (next.has(index)) next.delete(index); else next.add(index)
    return next
  })
  const allOn = rows.length > 0 && rows.every((row) => keepMine.has(row.index))
  const resolve = () => {
    onResolve([...keepMine].map((index) => conflict.changes[index]))
    restoreRef.current?.focus?.()
  }

  return <section className="chart-conflict" aria-labelledby="chart-conflict-head" aria-describedby="chart-conflict-sub">
    <div className="chart-conflict-head" role="alert">
      <strong id="chart-conflict-head">⟳ دُمجت تعديلات من جهاز آخر</strong>
      <span id="chart-conflict-sub">{conflict.changes.length} حقلًا تغيّر — علّم ما تريد استرجاع قيمتك فيه، أو اقبل تعديلات الجهاز الآخر كما هي.</span>
    </div>
    <label className="conflict-all">
      <input type="checkbox" checked={allOn} onChange={() => setRows(rows, !allOn)} />
      <span>استرجع قيمتي في كل الحقول</span>
    </label>
    <div className="chart-conflict-groups">
      {groups.map((group) => {
        const groupOn = group.rows.every((row) => keepMine.has(row.index))
        return <div className="conflict-group" key={group.kind}>
          <label className="conflict-group-head">
            <input type="checkbox" checked={groupOn} onChange={() => setRows(group.rows, !groupOn)} />
            <span>{group.label}</span>
            <span className="conflict-group-count">{group.rows.length}</span>
          </label>
          <ul className="chart-conflict-list">
            {group.rows.map((row) => <li key={row.index}>
              <label>
                <input type="checkbox" checked={keepMine.has(row.index)} onChange={() => toggleOne(row.index)}
                  aria-label={`استرجع قيمتي في ${row.what}: ${row.mine || 'فارغ'} بدل ${row.theirs || 'فارغ'}`} />
                <span className="conflict-what">{row.what}</span>
                <span className="conflict-vals"><b>{row.mine || '—'}</b> ← <b>{row.theirs || '—'}</b></span>
              </label>
            </li>)}
          </ul>
        </div>
      })}
    </div>
    <div className="chart-conflict-actions">
      <span className="conflict-hint">{keepMine.size
        ? `${keepMine.size} حقلًا ستُستعاد إلى قيمتك`
        : 'ستُقبل كل تعديلات الجهاز الآخر'}</span>
      <button type="button" className="primary-button compact" onClick={resolve}>تطبيق</button>
    </div>
  </section>
}
