import { useState } from 'react'

// The pill form's ملاحظات cell: free text the pharmacist can type and edit, with the two stock
// notes one tap away in a dropdown (picking one appends it on a new line, unless that would pass
// maxLength — what one cell of the printed sheet holds). On paper only the text prints — the
// .pill-note-print span stands in for the textarea and the dropdown.
export default function PillNote({ value, presets, label, maxLength, onChange }) {
  const [full, setFull] = useState(false)
  return <div className="pill-note">
    <span className="pill-note-print">{value}</span>
    <textarea aria-label={label} value={value} rows={2} maxLength={maxLength} onChange={(event) => { setFull(false); onChange(event.target.value) }} />
    <select aria-label={`${label} — جاهزة`} value="" onChange={(event) => {
      const preset = event.target.value
      if (!preset || value.includes(preset)) return
      const next = value ? `${value}\n${preset}` : preset
      if (next.length > maxLength) { setFull(true); return }
      setFull(false)
      onChange(next)
    }}>
      <option value="">+ ملاحظة جاهزة</option>
      {presets.map((preset) => <option key={preset} value={preset}>{preset}</option>)}
    </select>
    {full && <span className="pill-note-full" role="status">لا يتّسع الحقل لهذه الملاحظة — اختصر النص أولًا.</span>}
  </div>
}
