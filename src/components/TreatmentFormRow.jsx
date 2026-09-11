import { useRef, useState } from 'react'
import { formatFileSize } from '../helpers.js'
import { apiUrl } from '../constants.js'

// One استمارات العلاج row for a manager: rename inline, pick a replacement file (staged until
// "حفظ", mirroring MedicineRow's dirty-then-save shape), or delete. A plain member never
// mounts this — TreatmentFormsScreen renders a read-only row for them instead.
export default function TreatmentFormRow({ item, onSave, onRemove, busy }) {
  const [title, setTitle] = useState(item.title)
  const [file, setFile] = useState(null)
  const fileInputRef = useRef(null)
  const dirty = title.trim() !== item.title || file !== null

  const save = () => {
    onSave(item.id, title.trim(), file)
    setFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return <tr>
    <td><input value={title} onChange={(event) => setTitle(event.target.value)} /></td>
    <td>
      {formatFileSize(item.fileSize)}
      {file && <span className="form-file-pending"> — سيُستبدل بـ«{file.name}»</span>}
    </td>
    <td className="requests-actions">
      <a className="secondary-button compact" href={`${apiUrl}/treatment-forms/${item.id}/file`}>تنزيل</a>
      <label className="text-button form-replace-label">
        استبدال الملف
        <input ref={fileInputRef} type="file" accept="application/pdf" className="sr-only" onChange={(event) => setFile(event.target.files?.[0] || null)} />
      </label>
      <button className="primary-button compact" disabled={!dirty || busy} onClick={save}>حفظ</button>
      <button className="danger-button compact" disabled={busy} onClick={() => onRemove(item.id, item.title)}>حذف</button>
    </td>
  </tr>
}
