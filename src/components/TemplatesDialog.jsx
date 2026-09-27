import { useState } from 'react'

// «قوالب الأدوية» — the pharmacist's own saved sets of medicine columns. Same modal chrome and
// keyboard handling as ConfirmDialog / CopyChartDialog. Applying replaces the chart's columns,
// so it is only offered while the chart has no doses (`canApply`); the reason shows otherwise.
export default function TemplatesDialog({ open, templates, error, busy, canApply, canSave, onRetry, onApply, onDelete, onSave, onClose }) {
  const [name, setName] = useState('')
  if (!open) return null
  const save = async (event) => {
    event.preventDefault()
    if (name.trim() && canSave && !busy && await onSave(name.trim())) setName('')
  }
  return <div className="modal-backdrop" onClick={onClose}>
    <div className="medicine-modal templates-modal" role="dialog" aria-modal="true" aria-labelledby="templates-title"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onClose() } }}>
      <h2 id="templates-title">قوالب الأدوية</h2>
      <p className="templates-hint">قوالبك الخاصة: أسماء أعمدة الأدوية بترتيبها، تُطبَّق على جارت أي يوم لم تُدخَل فيه كميات بعد.</p>

      {!canApply && <p className="templates-note" role="status">لا يُطبَّق القالب بعد إدخال الكميات — يستبدل أعمدة الأدوية كلها.</p>}

      {error ? <div className="templates-empty">
        <span>تعذّر تحميل القوالب — تحقّق من الاتصال.</span>
        <button type="button" className="secondary-button compact" onClick={onRetry}>إعادة المحاولة</button>
      </div>
        : templates === null ? <p className="templates-empty" role="status">جارٍ تحميل القوالب…</p>
        : templates.length === 0 ? <p className="templates-empty">لا توجد قوالب بعد — احفظ أدوية هذا الجارت كقالب أدناه.</p>
        : <ul className="templates-list">
          {templates.map((template) => <li key={template.id}>
            <span className="templates-item-text">
              <strong>{template.name}</strong>
              <small><bdi dir="ltr">{template.medicines.slice(0, 4).join(' · ')}{template.medicines.length > 4 ? ' …' : ''}</bdi> ({template.medicines.length} دواء)</small>
            </span>
            <span className="templates-item-actions">
              <button type="button" className="primary-button compact" disabled={!canApply || busy} onClick={() => onApply(template)}>تطبيق</button>
              <button type="button" className="danger-button compact" disabled={busy} onClick={() => onDelete(template)}>حذف</button>
            </span>
          </li>)}
        </ul>}

      <form className="templates-save" onSubmit={save}>
        <label htmlFor="template-name">حفظ أدوية هذا الجارت كقالب</label>
        <div className="templates-save-row">
          <input id="template-name" value={name} maxLength={60} placeholder="اسم القالب" autoComplete="off" onChange={(event) => setName(event.target.value)} />
          <button type="submit" className="secondary-button compact" disabled={!canSave || !name.trim() || busy}>حفظ</button>
        </div>
        {!canSave && <small className="templates-hint">لا توجد أدوية في هذا الجارت لحفظها.</small>}
      </form>

      <div className="modal-actions">
        <button type="button" className="secondary-button" autoFocus onClick={onClose}>إغلاق</button>
      </div>
    </div>
  </div>
}
