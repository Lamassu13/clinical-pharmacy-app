import { useState } from 'react'

export default function MedicineRow({ item, onSave, onRemove, busy }) {
  const [name, setName] = useState(item.name)
  const [arabicName, setArabicName] = useState(item.arabic_name || '')
  const [isSupply, setIsSupply] = useState(Boolean(item.is_supply))
  const [noThursdayDouble, setNoThursdayDouble] = useState(Boolean(item.no_thursday_double))
  const dirty = name.trim() !== item.name || arabicName.trim() !== (item.arabic_name || '')
    || isSupply !== Boolean(item.is_supply) || noThursdayDouble !== Boolean(item.no_thursday_double)
  return <tr>
    <td><input value={name} onChange={(event) => setName(event.target.value)} /></td>
    <td><input value={arabicName} onChange={(event) => setArabicName(event.target.value)} placeholder="الاسم بالعربية" /></td>
    {/* مستلزم: left out of the reports' polypharmacy count. لا يُضاعف: Thursday's «المجموع المضاعف»
        and الطلبية repeat the normal total for it instead of doubling. */}
    <td className="medicine-flags">
      <label className="medicine-supply"><input type="checkbox" checked={isSupply} onChange={(event) => setIsSupply(event.target.checked)} /><span>مستلزم</span></label>
      <label className="medicine-supply"><input type="checkbox" checked={noThursdayDouble} onChange={(event) => setNoThursdayDouble(event.target.checked)} /><span>لا يُضاعف يوم الخميس</span></label>
    </td>
    <td className="requests-actions"><button className="primary-button compact" disabled={!dirty || busy} onClick={() => onSave(item.id, name.trim(), arabicName.trim(), isSupply, noThursdayDouble)}>حفظ</button><button className="danger-button compact" disabled={busy} onClick={() => onRemove(item.id, item.name)}>حذف</button></td>
  </tr>
}
