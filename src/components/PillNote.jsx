// The pill form's ملاحظات cell: free text the pharmacist can type and edit, with the two stock
// notes one tap away in a dropdown (picking one appends it on a new line). On paper only the
// text prints — the .pill-note-print span stands in for the textarea and the dropdown.
export default function PillNote({ value, presets, label, maxLength, onChange }) {
  return <div className="pill-note">
    <span className="pill-note-print">{value}</span>
    <textarea aria-label={label} value={value} rows={2} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} />
    <select aria-label={`${label} — جاهزة`} value="" onChange={(event) => {
      const preset = event.target.value
      if (preset && !value.includes(preset)) onChange(value ? `${value}\n${preset}` : preset)
    }}>
      <option value="">+ ملاحظة جاهزة</option>
      {presets.map((preset) => <option key={preset} value={preset}>{preset}</option>)}
    </select>
  </div>
}
