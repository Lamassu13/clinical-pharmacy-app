// A wrapping dropdown cell: the chosen text shows in full (a plain <select> would truncate
// it), with a transparent native <select> laid over the whole cell so it stays pickable.
// `label` is the accessible name for that select — there is no visible <label> in the grid,
// so without it a screen reader just hears "combo box". `groups`, when passed, renders
// <optgroup>s instead of a flat list. The empty state shows a muted "اختر" placeholder on
// screen (via CSS ::before) but prints as a blank cell, so paper never reads a prompt as an
// instruction.
export default function PillSelect({ value, options, groups, label, onChange }) {
  return <div className="pill-select" data-empty={value ? undefined : ''}>
    <span className="pill-select-value">{value}</span>
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">—</option>
      {groups
        ? groups.map(([groupLabel, groupOptions]) => <optgroup key={groupLabel} label={groupLabel}>
            {groupOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </optgroup>)
        : options.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>
  </div>
}
