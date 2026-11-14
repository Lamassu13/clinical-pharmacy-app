import { cleanField } from '../../shared/drug-requests.js'

// Pieces both request forms (MeropenemSheet, AlbuminSheet) are drawn with. Each comes in two modes:
// on the form's screen (`paper` false) values are boxes to type in and boxes to tick; on paper
// (`paper` true, drawn off-screen for the PDF) everything is plain text and the ticked indication is
// circled in a bold oval, as a doctor would circle it on the paper form. Each paper text is a single element, so html2canvas keeps Arabic letters joined.

// An indication on the paper form the pharmacist ticks. On screen the whole cell is the button (gloved
// thumb) with an empty square showing it can be ticked; ticked, the square gives way to a bold oval
// round the indication's text. `after` sits under it inside the cell, outside the oval.
// On paper the cell is a plain table cell and the oval is a bordered span (no ✓ character: the PDF
// renderer takes it from a fallback font and sets it below the line; no rotated shape: on iPhone the
// renderer drew a row holding a rotated element with its lines out of place). The text stays one element.
export function TickCell({ checked, onToggle, colSpan, className, children, after, paper }) {
  const classes = ['req-tick-cell', checked && 'req-tick-cell--on', className].filter(Boolean).join(' ')
  if (paper) return <td colSpan={colSpan} className={classes}>
    {checked ? <span className="req-circled">{children}</span> : children}{after}
  </td>
  return <td colSpan={colSpan} className={classes}>
    <button type="button" className="req-tick" aria-pressed={checked} onClick={onToggle}>
      <span className="req-tick-box" aria-hidden="true" />
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
  const input = <input className="req-input" defaultValue={shown} key={shown} dir={ltr || field?.digits || field?.decimal ? 'ltr' : 'auto'}
    inputMode={field?.digits ? 'numeric' : field?.decimal ? 'decimal' : undefined} maxLength={field?.max || 200} autoComplete="off"
    aria-label={label.replace(/:$/, '')} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') event.target.blur() }} />
  return <label className="req-field">
    {!bare && <span className="req-label">{label}</span>}
    {/* The unit travels with its blank, so a phone never leaves «kg» alone on a line of its own. */}
    {unit ? <span className="req-blank">{input}<span className="req-unit">{unit}</span></span> : input}
  </label>
}
