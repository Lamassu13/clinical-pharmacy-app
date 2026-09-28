import { useEffect, useRef, useState } from 'react'
import { ChevronStart, StatusCheck } from './WardGlyph.jsx'

// What each flag changes, shown on screen under its checkbox — both alter clinical output.
const FLAG_HELP = {
  isSupply: 'لا يُحسب ضمن عدد الأدوية لكل مريض في التقارير.',
  noThursdayDouble: 'يُطلب يوم الخميس بالكمية العادية بدل الضعف، في «المجموع المضاعف» وفي «الطلبية».',
}

// One catalogue entry at rest: the name to scan for, its Arabic name when it has one, and a
// chip only for a flag that is set. The whole row is the button that opens the editor.
export function MedicineItem({ item, saved, onEdit }) {
  return <button type="button" className="medicine-item" onClick={onEdit} aria-label={`تعديل ${item.name}`}>
    <span className="medicine-item-names">
      <bdi className="medicine-item-name" dir="ltr">{item.name}</bdi>
      {item.arabic_name && <span className="medicine-item-arabic">{item.arabic_name}</span>}
    </span>
    <span className="medicine-item-flags">
      {item.is_supply && <span className="medicine-flag">مستلزم</span>}
      {item.no_thursday_double && <span className="medicine-flag">لا يُضاعف يوم الخميس</span>}
      {saved && <span className="medicine-saved" role="status"><StatusCheck /> تم الحفظ</span>}
    </span>
    <span className="medicine-item-go" aria-hidden="true"><ChevronStart /></span>
  </button>
}

// The one open editor. A real <form>, so Enter saves; Escape cancels. `onDirtyChange` lets the
// screen ask before another row (or the page) would throw these edits away.
export default function MedicineEditor({ item, busy, error, onSave, onCancel, onRemove, onDirtyChange }) {
  const [name, setName] = useState(item.name)
  const [arabicName, setArabicName] = useState(item.arabic_name || '')
  const [isSupply, setIsSupply] = useState(Boolean(item.is_supply))
  const [noThursdayDouble, setNoThursdayDouble] = useState(Boolean(item.no_thursday_double))
  const ref = useRef(null)
  const dirty = name.trim() !== item.name || arabicName.trim() !== (item.arabic_name || '')
    || isSupply !== Boolean(item.is_supply) || noThursdayDouble !== Boolean(item.no_thursday_double)
  const id = `medicine-${item.id}`

  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  useEffect(() => { ref.current?.scrollIntoView({ block: 'nearest' }) }, [])

  const submit = (event) => {
    event.preventDefault()
    if (!dirty || busy || !name.trim()) return
    onSave({ name: name.trim(), arabicName: arabicName.trim(), isSupply, noThursdayDouble })
  }

  return <form
    className="medicine-editor" ref={ref} onSubmit={submit} aria-label={`تعديل ${item.name}`}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onCancel() } }}
  >
    <div className="medicine-editor-fields">
      <label htmlFor={`${id}-name`}>الاسم (إنجليزي)
        <input id={`${id}-name`} dir="ltr" value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" required />
      </label>
      <label htmlFor={`${id}-arabic`}>الاسم بالعربية
        <input id={`${id}-arabic`} value={arabicName} onChange={(event) => setArabicName(event.target.value)} placeholder="اختياري" autoComplete="off" />
      </label>
    </div>
    <fieldset className="medicine-editor-flags">
      <legend>الخصائص</legend>
      <label className="medicine-flag-option">
        <input type="checkbox" checked={isSupply} onChange={(event) => setIsSupply(event.target.checked)} />
        <span><strong>مستلزم</strong><small>{FLAG_HELP.isSupply}</small></span>
      </label>
      <label className="medicine-flag-option">
        <input type="checkbox" checked={noThursdayDouble} onChange={(event) => setNoThursdayDouble(event.target.checked)} />
        <span><strong>لا يُضاعف يوم الخميس</strong><small>{FLAG_HELP.noThursdayDouble}</small></span>
      </label>
    </fieldset>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="medicine-editor-actions">
      <button type="submit" className="primary-button compact" disabled={!dirty || busy || !name.trim()}>{busy ? 'جارٍ الحفظ…' : 'حفظ'}</button>
      <button type="button" className="secondary-button compact" onClick={onCancel}>إلغاء</button>
      <button type="button" className="danger-button compact medicine-editor-delete" disabled={busy} onClick={onRemove}>حذف الدواء</button>
    </div>
  </form>
}
