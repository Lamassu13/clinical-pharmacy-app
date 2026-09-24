import { useState } from 'react'

export default function MedicineRow({ item, onSave, onRemove, busy }) {
  const [name, setName] = useState(item.name)
  const [arabicName, setArabicName] = useState(item.arabic_name || '')
  const [isSupply, setIsSupply] = useState(Boolean(item.is_supply))
  const dirty = name.trim() !== item.name || arabicName.trim() !== (item.arabic_name || '') || isSupply !== Boolean(item.is_supply)
  return <tr>
    <td><input value={name} onChange={(event) => setName(event.target.value)} /></td>
    <td><input value={arabicName} onChange={(event) => setArabicName(event.target.value)} placeholder="الاسم بالعربية" /></td>
    {/* Supplies (IV set, cannula, syringe, IV fluids…) are left out of the reports' polypharmacy count. */}
    <td className="medicine-supply-cell"><label className="medicine-supply"><input type="checkbox" checked={isSupply} onChange={(event) => setIsSupply(event.target.checked)} /><span>مستلزم</span></label></td>
    <td className="requests-actions"><button className="primary-button compact" disabled={!dirty || busy} onClick={() => onSave(item.id, name.trim(), arabicName.trim(), isSupply)}>حفظ</button><button className="danger-button compact" disabled={busy} onClick={() => onRemove(item.id, item.name)}>حذف</button></td>
  </tr>
}
