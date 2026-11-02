// Pieces both paper request forms (MeropenemSheet, AlbuminSheet) are drawn with.

// A box on the paper form the pharmacist ticks: the whole cell is the button (gloved thumb). On
// screen an empty square shows it can be ticked; on paper only a ticked box carries its ✓ (the blank
// form has no squares). `after` sits under the button, inside the cell (the «Others» text box).
export function TickCell({ checked, onToggle, colSpan, className, children, after }) {
  return <td colSpan={colSpan} className={['req-tick-cell', checked && 'req-tick-cell--on', className].filter(Boolean).join(' ')}>
    <button type="button" className="req-tick" aria-pressed={checked} onClick={onToggle}>
      <span className="req-tick-box" aria-hidden="true">{checked ? '✓' : ''}</span>
      <span className="req-tick-text">{children}</span>
    </button>
    {after}
  </td>
}

// The spec's **bold** words inside a normal-weight line.
export const Rich = ({ text }) => String(text).split(/\*\*(.+?)\*\*/).map((part, index) => (index % 2 ? <strong key={index}>{part}</strong> : part))

// One «label: value» line of a filled form; the value prints bold, as if written in.
export const Filled = ({ label, value, unit, ltr }) => <>
  <span className="req-label">{label}</span> <bdi className="req-value" dir={ltr ? 'ltr' : undefined}>{value ? `${value}${unit ? ` ${unit}` : ''}` : ''}</bdi>
</>
