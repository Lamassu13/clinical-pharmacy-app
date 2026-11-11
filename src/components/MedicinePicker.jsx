import { useRef, useState } from 'react'
import { medicineMatches } from '../helpers.js'

// The column header's picker on touch devices: a 11px vertical field is no place to type on a phone (iOS zooms
// into it, and the suggestion list opens under the on-screen keyboard). Anchored to the TOP of the screen for
// the same reason — the keyboard can never cover the list. It only chooses: a pick goes through the same
// onApplySuggestion the typed header uses, so seeding, the catalogue rule and autosave are untouched.
// Removing the medicine wipes that column's quantities, so with doses in it the button asks twice.
export default function MedicinePicker({ column, current, medicines, filled, onPick, onClear, onClose }) {
  const [query, setQuery] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const searchRef = useRef(null)
  const shown = query.trim() ? medicineMatches(query, medicines, 50) : medicines
  // Let go of the search box before the dialog goes: unmounting a focused field fires no blur, and the previous-day
  // offer (App) waits on that focus leaving.
  const leave = (action) => { searchRef.current?.blur(); action() }
  return <div className="modal-backdrop modal-backdrop--top" onClick={() => leave(onClose)}>
    <div className="medicine-modal medicine-picker" role="dialog" aria-modal="true" aria-labelledby="medicine-picker-title"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); leave(onClose) } }}>
      <button type="button" className="close-button" aria-label="إغلاق" onClick={() => leave(onClose)}>×</button>
      <h2 id="medicine-picker-title">اختر الدواء — عمود {column + 1}</h2>
      {current && <p className="picker-current">الحالي: <bdi dir="ltr">{current}</bdi></p>}
      <input ref={searchRef} type="search" autoFocus dir="auto" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث باسم الدواء"
        aria-label="ابحث باسم الدواء" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} enterKeyHint="search" />
      {shown.length
        ? <ul className="picker-list">{shown.map((name) => <li key={name}><button type="button" aria-current={name === current || undefined} onClick={() => leave(() => onPick(name))}><bdi dir="ltr">{name}</bdi></button></li>)}</ul>
        : <p className="picker-empty" role="status">لا يوجد دواء بهذا الاسم في القائمة.</p>}
      {current && <button type="button" className="danger-button compact picker-remove"
        onClick={() => (filled && !confirmClear ? setConfirmClear(true) : leave(onClear))}>
        {confirmClear ? `تأكيد — تُمسح ${filled} كمية` : 'إزالة الدواء من العمود'}
      </button>}
    </div>
  </div>
}
