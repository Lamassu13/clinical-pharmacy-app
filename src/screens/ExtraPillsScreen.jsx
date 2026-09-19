import { useState } from 'react'
import { flushSync } from 'react-dom'
import hospitalLogo from '../assets/hospital-logo.png'
import PillSelect from '../components/PillSelect.jsx'
import { usageMethods, noteOptions, doseTimeGroups } from '../constants.js'

// استمارة الحبوب الإضافي — the same .pill-form/.pill-table markup and print CSS as the real
// pills form (PillsScreen.jsx), but with no chart behind it at all: the patient name and
// every medicine slot are typed directly here, one form is exactly 7 medicine rows (never
// paginated — 7 is this form's fixed size, not a per-page split of a longer chart-derived
// list), and forms are explicit save/dirty like TreatmentFormRow rather than autosaved on
// every keystroke — a deliberate simplification for a secondary, occasional-use tool.
function ExtraPillFormCard({ form, floorLabel, today, editTime, selected, onToggleSelect, willPrint, printLast, onSave, onRemove, busy }) {
  const [patientName, setPatientName] = useState(form.patientName)
  const [roomNumber, setRoomNumber] = useState(form.roomNumber)
  const [entries, setEntries] = useState(form.entries)
  const dirty = patientName !== form.patientName || roomNumber !== form.roomNumber || JSON.stringify(entries) !== JSON.stringify(form.entries)
  // Set by App.jsx when this create/edit is still queued offline (see enqueueExtraPillsOp) —
  // a not-yet-created form's id is a local "temp-" placeholder, not a real one yet either.
  const pendingSync = form.pending || (typeof form.id === 'string' && form.id.startsWith('temp-'))

  const setEntry = (slot, patch) => setEntries((current) => current.map((entry) => (entry.slot === slot ? { ...entry, ...patch } : entry)))
  const save = () => onSave(form.id, { patientName: patientName.trim(), roomNumber: roomNumber.trim(), entries })

  return <article className={`pill-form${willPrint ? '' : ' not-printing'}${printLast ? ' print-last' : ''}`}>
    <div className="pill-form-head">
      <label className="pill-pick"><input type="checkbox" checked={selected} onChange={() => onToggleSelect(form.id)} /><span>تحديد للطباعة</span></label>
      <div className="pill-form-patient">
        {/* An <input> never shrinks to its value's width the way the real form's plain
            <strong>{patient.name}</strong> does — left at that, this field stayed as wide as
            its min-width regardless of the typed name, which shifted رقم الغرفة and the
            hospital brand out of the real form's position in the header's flex row. Printing
            a plain <strong> instead (screen keeps the input) makes the printed header
            structurally identical to the real form's, so it lays out identically too. */}
        <input className="pill-form-patient-input" aria-label="اسم المريض" placeholder="اسم المريض" value={patientName} onChange={(event) => setPatientName(event.target.value)} />
        <strong className="pill-form-patient-print">{patientName}</strong>
        <span>{today}</span>
      </div>
      <label className="pill-room">رقم الغرفة <input inputMode="numeric" value={roomNumber} onChange={(event) => setRoomNumber(event.target.value)} /></label>
      <div className="pill-form-brand">
        <div className="pill-form-title"><strong>مستشفى بغداد التعليمي</strong><span>وحدة الصيدلة السريرية</span><span>{floorLabel}</span></div>
        <img className="hospital-logo header-logo" width="42" height="42" src={hospitalLogo} alt="" />
      </div>
      <span className="extra-pill-form-actions">
        {pendingSync && <span className="save-state save-state-pending" role="status">○ معلّق للمزامنة</span>}
        <button type="button" className="primary-button compact" disabled={!dirty || busy} onClick={save}>حفظ</button>
        <button type="button" className="danger-button compact" disabled={busy} onClick={() => onRemove(form.id)}>حذف الاستمارة</button>
      </span>
    </div>
    <div className="pill-table-scroll">
      <table className="pill-table">
        <thead><tr><th scope="col"></th><th scope="col">العلاج</th><th className="pill-qty-cell" scope="col">كمية الحبوب</th><th scope="col">وقت الجرعة</th><th scope="col">طريقة الاستخدام</th><th scope="col">الملاحظات</th></tr></thead>
        <tbody>{entries.map((entry) => {
          const medName = entry.medicineName || `دواء ${entry.slot}`
          return <tr key={entry.slot}>
            <td className="pill-lead-cell"></td>
            <td className="pill-name-cell">
              <input aria-label={`العلاج — سطر ${entry.slot}`} placeholder="اسم العلاج" value={entry.medicineName} onChange={(event) => setEntry(entry.slot, { medicineName: event.target.value })} />
              {/* Printed via this span, not the input itself: Safari drops an <input>'s
                  placeholder when printing, but a real typed value prints fine either way — an
                  empty field should print truly blank (no hint text), which an empty span
                  already does for free. Same swap as .pill-form-patient-print and PillSelect's
                  .pill-select-value. */}
              <span className="pill-name-cell-print">{entry.medicineName}</span>
            </td>
            <td className="pill-qty-cell"><input inputMode="numeric" aria-label={`كمية الحبوب — ${medName}`} value={entry.pillQty} onChange={(event) => setEntry(entry.slot, { pillQty: event.target.value.replace(/\D/g, '') })} /></td>
            <td><PillSelect value={entry.doseTime} groups={doseTimeGroups} label={`وقت الجرعة — ${medName}`} onChange={(nextValue) => setEntry(entry.slot, { doseTime: nextValue })} /></td>
            <td><PillSelect value={entry.usageMethod} options={usageMethods} label={`طريقة الاستخدام — ${medName}`} onChange={(nextValue) => setEntry(entry.slot, { usageMethod: nextValue })} /></td>
            <td><PillSelect value={entry.note} options={noteOptions} label={`الملاحظات — ${medName}`} onChange={(nextValue) => setEntry(entry.slot, { note: nextValue })} /></td>
          </tr>
        })}</tbody>
      </table>
    </div>
    <div className="pill-form-foot"><span className="pill-sign">توقيع الصيدلاني السريري</span><span className="pill-edit-time">وقت التحرير: {editTime}</span></div>
  </article>
}

export default function ExtraPillsScreen({
  header, floorLabel, today, editTime, onBack,
  loading, loadError, forms, busy, actionError, onCreate, onSave, onRemove, confirmModal,
}) {
  const [selection, setSelection] = useState(() => new Set())
  const [printScope, setPrintScope] = useState('all')
  const toggleSelect = (id) => setSelection((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
  // See startPillsPrint in App.jsx: window.print() doesn't block on iOS/iPadOS Safari, so the
  // scope reset has to wait for the real afterprint event instead of running right after the
  // call — otherwise the scope reverts to "all" before the iPad's print sheet captures the page.
  const startPrint = (scope) => {
    flushSync(() => setPrintScope(scope))
    const resetScope = () => { setPrintScope('all'); window.removeEventListener('afterprint', resetScope) }
    window.addEventListener('afterprint', resetScope)
    window.print()
  }
  const printingIds = forms.filter((form) => printScope === 'all' || selection.has(form.id)).map((form) => form.id)
  const lastPrintingId = printingIds[printingIds.length - 1]

  return <main className="app-shell">
    {header}
    <section className="pills-page">
      <div className="chart-toolbar pills-toolbar">
        <button className="back-button" onClick={onBack}>→ العودة للطابق</button>
        <div><p className="modal-kicker">استمارة الحبوب الإضافي</p><h1>{floorLabel}</h1></div>
        <div className="toolbar-actions">
          <button className="primary-button compact" onClick={onCreate} disabled={busy}>+ إنشاء استمارة جديدة</button>
          <button className="secondary-button compact" onClick={() => startPrint('all')} disabled={forms.length === 0}>طباعة الكل</button>
          <button className="secondary-button compact" disabled={selection.size === 0} onClick={() => startPrint('selected')}>طباعة المحدّدين ({selection.size})</button>
        </div>
      </div>

      {actionError && <p className="form-error" role="alert">{actionError}</p>}

      {loading ? <div className="empty-state"><span className="spinner" /><span>جارٍ تحميل الاستمارات…</span></div>
        : loadError ? <div className="empty-state"><strong>تعذّر تحميل الاستمارات</strong></div>
        : forms.length === 0 ? <div className="empty-state"><strong>لا توجد استمارات بعد</strong><span>اضغط «+ إنشاء استمارة جديدة» لإضافة أول مريض.</span></div>
        : forms.map((form) => <ExtraPillFormCard
            key={form.id} form={form} floorLabel={floorLabel} today={today} editTime={editTime}
            selected={selection.has(form.id)} onToggleSelect={toggleSelect}
            willPrint={printScope === 'all' || selection.has(form.id)} printLast={form.id === lastPrintingId}
            onSave={onSave} onRemove={onRemove} busy={busy}
          />)}
    </section>{confirmModal}
  </main>
}
