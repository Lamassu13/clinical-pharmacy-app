import { useState } from 'react'

export default function MedicineRow({ item, onSave, onRemove, busy }) {
  const [name, setName] = useState(item.name)
  const [arabicName, setArabicName] = useState(item.arabic_name || '')
  const dirty = name.trim() !== item.name || arabicName.trim() !== (item.arabic_name || '')
  return <tr>
    <td><input value={name} onChange={(event) => setName(event.target.value)} /></td>
    <td><input value={arabicName} onChange={(event) => setArabicName(event.target.value)} placeholder="الاسم بالعربية" /></td>
    <td className="requests-actions"><button className="primary-button compact" disabled={!dirty || busy} onClick={() => onSave(item.id, name.trim(), arabicName.trim())}>حفظ</button><button className="danger-button compact" disabled={busy} onClick={() => onRemove(item.id, item.name)}>حذف</button></td>
  </tr>
}
