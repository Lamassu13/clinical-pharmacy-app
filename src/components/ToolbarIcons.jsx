// Chart-toolbar icons: one family — 24-grid, 1.6 stroke, round caps, a soft tint body (.tb-t),
// a deeper tint (.tb-t2) and solid details (.tb-f / .tb-bd). Colour comes from currentColor, so
// the same drawing works on the filled and the outline button; the plus badge's cut-out reads
// the button's own background through --btn.
const ICONS = {
  patient: <>
    <path className="tb-t" d="M2.8 20.4c0-3.9 3-6.6 6.7-6.6 1.3 0 2.5.3 3.5.9l-.6 5.7z" />
    <circle className="tb-t2" cx="9.5" cy="7.4" r="3.7" /><circle cx="9.5" cy="7.4" r="3.7" />
    <path d="M2.8 20.4c0-3.9 3-6.6 6.7-6.6 1.2 0 2.3.3 3.3.8" />
    <circle className="tb-bd" cx="18" cy="16.8" r="4.2" /><path className="tb-bp" d="M18 14.6v4.4M15.8 16.8h4.4" />
  </>,
  column: <>
    <rect className="tb-t" x="2.8" y="4" width="14.4" height="16" rx="2.2" />
    <path className="tb-t2" d="M2.8 6.2A2.2 2.2 0 0 1 5 4h10a2.2 2.2 0 0 1 2.2 2.2V9H2.8z" />
    <rect x="2.8" y="4" width="14.4" height="16" rx="2.2" />
    <path d="M2.8 9h14.4M2.8 14.5h14.4M8 9v11M12.6 9v11" />
    <circle className="tb-bd" cx="18" cy="17.4" r="4" /><path className="tb-bp" d="M18 15.3v4.2M15.9 17.4h4.2" />
  </>,
  complete: <>
    <rect className="tb-t" x="4.8" y="4.4" width="14.4" height="16.8" rx="2.4" /><rect x="4.8" y="4.4" width="14.4" height="16.8" rx="2.4" />
    <rect className="tb-f" x="8.8" y="2.4" width="6.4" height="3.8" rx="1.3" />
    <path strokeWidth="2.1" d="M8.4 13.1l2.7 2.8 4.6-5.3" /><path d="M8.6 18.4h6.8" />
  </>,
  print: <>
    <path d="M7 8.6V4.2A1.2 1.2 0 0 1 8.2 3h7.6A1.2 1.2 0 0 1 17 4.2v4.4" />
    <rect className="tb-t2" x="2.8" y="8.6" width="18.4" height="8.2" rx="2.4" /><rect x="2.8" y="8.6" width="18.4" height="8.2" rx="2.4" />
    <path className="tb-t" d="M7 14h10v6.4a.8.8 0 0 1-.8.8H7.8a.8.8 0 0 1-.8-.8z" /><path d="M7 14h10v6.4a.8.8 0 0 1-.8.8H7.8a.8.8 0 0 1-.8-.8zM9.6 17h4.8M9.6 19.1h3" />
    <circle className="tb-f" cx="18.2" cy="11.4" r=".95" />
  </>,
  pills: <>
    <rect className="tb-t" x="3" y="3.4" width="18" height="17.2" rx="2.8" /><rect x="3" y="3.4" width="18" height="17.2" rx="2.8" />
    <rect className="tb-t2" x="5.6" y="5.8" width="5.2" height="5.2" rx="2.6" /><rect x="5.6" y="5.8" width="5.2" height="5.2" rx="2.6" /><path d="M6.7 9.9l3-3" />
    <rect className="tb-t2" x="13.2" y="5.8" width="5.2" height="5.2" rx="2.6" /><rect x="13.2" y="5.8" width="5.2" height="5.2" rx="2.6" /><path d="M14.3 9.9l3-3" />
    <circle className="tb-t2" cx="8.2" cy="16.2" r="2.6" /><circle cx="8.2" cy="16.2" r="2.6" /><path d="M6.6 16.2h3.2" />
    <circle className="tb-t2" cx="15.8" cy="16.2" r="2.6" /><circle cx="15.8" cy="16.2" r="2.6" /><path d="M14.2 16.2h3.2" />
  </>,
  order: <>
    <path className="tb-t2" d="M12 3 3.6 7.2 12 11.4l8.4-4.2z" />
    <path className="tb-t" d="M3.6 7.2v9.4L12 21v-9.6zM12 21l8.4-4.4V7.2L12 11.4z" />
    <path d="M12 3 3.6 7.2v9.4L12 21l8.4-4.4V7.2zM3.6 7.2 12 11.4l8.4-4.2M12 11.4V21M7.8 5.1l8.4 4.2" />
  </>,
}

// An icon-only button: the name is the accessible label and the tooltip (data-tip shows at once
// on hover, keyboard focus and press-and-hold). `busy` swaps the drawing for the app spinner.
export default function ToolbarButton({ icon, label, primary, busy, ...props }) {
  return (
    <button type="button" className={`${primary ? 'primary-button' : 'secondary-button'} tb-button`} aria-label={label} data-tip={label} {...props}>
      {busy ? <span className="spinner" aria-hidden="true" /> : <svg viewBox="0 0 24 24" aria-hidden="true">{ICONS[icon]}</svg>}
    </button>
  )
}
