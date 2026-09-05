export default function PillSelect({ value, options, onChange }) {
  return <div className="pill-select"><span className="pill-select-value">{value || '—'}</span><select value={value} onChange={(event) => onChange(event.target.value)}><option value="">—</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></div>
}
