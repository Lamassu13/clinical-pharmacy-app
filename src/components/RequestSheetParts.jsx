import { cleanField } from '../../shared/drug-requests.js'

// Pieces both request forms (MeropenemSheet, AlbuminSheet) are drawn with. Each comes in two modes:
// on the form's screen (`paper` false) values are boxes to type in and boxes to tick; on paper
// (`paper` true, drawn off-screen for the PDF) everything is plain text and only a ticked box carries
// its ✓. Each paper text is a single element, so html2canvas keeps Arabic letters joined.

// A box on the paper form the pharmacist ticks. On screen the whole cell is the button (gloved
// thumb) with an empty square showing it can be ticked; `after` sits under it inside the cell.
export function TickCell({ checked, onToggle, colSpan, className, children, after, paper }) {
  const classes = ['req-tick-cell', checked && 'req-tick-cell--on', className].filter(Boolean).join(' ')
  // On paper the tick is drawn, not a ✓ character: the PDF renderer takes ✓ from a fallback font and
  // sets it below the line.
  if (paper) return <td colSpan={colSpan} className={classes}><div className="req-tick">
    {checked && <span className="req-tick-mark" aria-hidden="true" />}<span className="req-tick-text">{children}</span>
  </div>{after}</td>
  return <td colSpan={colSpan} className={classes}>
    <button type="button" className="req-tick" aria-pressed={checked} onClick={onToggle}>
      <span className="req-tick-box" aria-hidden="true">{checked ? '✓' : ''}</span>
      <span className="req-tick-text">{children}</span>
    </button>
    {after}
  </td>
}

// The spec's **bold** words inside a normal-weight line.
export const Rich = ({ text }) => String(text).split(/\*\*(.+?)\*\*/).map((part, index) => (index % 2 ? <strong key={index}>{part}</strong> : part))

// One «label: value» of a filled form. On paper the value prints bold, as if written in; on screen
// it is a box sitting in its place on the form, saved when focus leaves it (`onSave(value)`, only
// when it changed). `field` is its shared/drug-requests.js spec, which cleans numbers; `required`
// puts the old value back instead of saving an empty one; `bare` shows no label (the row's header
// cell already says it) but keeps it for screen readers.
export function Field({ label, value, unit, ltr, paper, field, required, bare, onSave }) {
  const shown = value || ''
  if (paper) return <>
    {!bare && <><span className="req-label">{label}</span> </>}<bdi className="req-value" dir={ltr ? 'ltr' : undefined}>{shown ? `${shown}${unit ? ` ${unit}` : ''}` : ''}</bdi>
  </>
  const commit = (event) => {
    const input = event.target
    const next = field ? cleanField(field, input.value) : input.value.trim().replace(/\s+/g, ' ')
    if (required && !next) { input.value = shown; return }
    input.value = next
    if (next !== shown) onSave(next)
  }
  return <label className="req-field">
    {!bare && <span className="req-label">{label}</span>}
    <input className="req-input" defaultValue={shown} key={shown} dir={ltr || field?.digits || field?.decimal ? 'ltr' : 'auto'}
      inputMode={field?.digits ? 'numeric' : field?.decimal ? 'decimal' : undefined} maxLength={field?.max || 200} autoComplete="off"
      aria-label={label.replace(/:$/, '')} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') event.target.blur() }} />
    {unit && <span className="req-unit">{unit}</span>}
  </label>
}
