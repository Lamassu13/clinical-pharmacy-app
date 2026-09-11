import { useRef, useState } from 'react'
import TreatmentFormRow from '../components/TreatmentFormRow.jsx'
import { formatFileSize } from '../helpers.js'
import { apiUrl } from '../constants.js'

// Title + file picker, staged locally and only handed up on submit — mirrors the
// AdminMedicinesScreen add-row, just carrying a File instead of a name string.
function UploadRow({ busy, onUpload }) {
  const [title, setTitle] = useState('')
  const [file, setFile] = useState(null)
  const fileInputRef = useRef(null)
  const submit = (event) => {
    event.preventDefault()
    if (!title.trim() || !file) return
    onUpload(title.trim(), file)
    setTitle('')
    setFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }
  return <form className="medicine-add-row" onSubmit={submit}>
    <input placeholder="عنوان الاستمارة" value={title} onChange={(event) => setTitle(event.target.value)} />
    <input ref={fileInputRef} type="file" accept="application/pdf" onChange={(event) => setFile(event.target.files?.[0] || null)} />
    <button className="primary-button compact" type="submit" disabled={busy || !title.trim() || !file}>{busy ? 'جارٍ الرفع…' : 'رفع'}</button>
  </form>
}

// استمارات العلاج — every member reads and downloads; a manager also uploads, renames,
// replaces, or deletes (TreatmentFormRow). No role check gates who can OPEN this screen —
// App.jsx dispatches here for everyone, and isManager only toggles the write controls.
export default function TreatmentFormsScreen({
  adminHeader, isManager, forms, formCount, formFilter, setFormFilter, loading, loadError, onRetry,
  registrationsError, adminSuccess, busy, onUpload, onSave, onRemove, confirmModal,
}) {
  return <main className="app-shell">{adminHeader}<section className="dashboard">
    <div className="section-heading">
      <div><h1>استمارات العلاج</h1></div>
      <div className="date-chip"><span>{formFilter ? 'نتيجة البحث' : 'عدد الاستمارات'}</span><strong>{formFilter ? `${forms.length} / ${formCount}` : formCount}</strong></div>
    </div>

    {registrationsError && <p className="form-error" role="alert">{registrationsError}</p>}
    {adminSuccess && <p className="form-success" role="status">{adminSuccess}</p>}

    {isManager && <UploadRow busy={busy} onUpload={onUpload} />}
    <input className="medicine-filter" placeholder="بحث في الاستمارات…" value={formFilter} onChange={(event) => setFormFilter(event.target.value)} />

    {loading ? <div className="empty-state"><span className="spinner" /><span>جارٍ تحميل الاستمارات…</span></div>
      : loadError ? <div className="empty-state"><strong>تعذّر تحميل الاستمارات</strong><button type="button" className="text-button" onClick={onRetry}>إعادة المحاولة</button></div>
      : forms.length === 0 ? <div className="empty-state"><strong>لا توجد استمارات بعد</strong>{isManager && <span>ارفع أول استمارة أعلاه.</span>}</div>
        : <div className="table-frame"><table className="requests-table">
            <thead><tr><th>العنوان</th><th>الحجم</th><th>{isManager ? 'إجراء' : 'تنزيل'}</th></tr></thead>
            <tbody>{forms.map((item) => isManager
              ? <TreatmentFormRow key={item.id} item={item} onSave={onSave} onRemove={onRemove} busy={busy} />
              : <tr key={item.id}>
                  <td>{item.title}</td>
                  <td>{formatFileSize(item.fileSize)}</td>
                  <td className="requests-actions"><a className="primary-button compact" href={`${apiUrl}/treatment-forms/${item.id}/file`}>تنزيل</a></td>
                </tr>)}</tbody>
          </table></div>}
  </section>{confirmModal}</main>
}
