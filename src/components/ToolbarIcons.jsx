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
  floor: <><path className="tb-t" d="M12 3.5 21 8l-9 4.5L3 8z" /><path d="M12 3.5 21 8l-9 4.5L3 8zM3 12l9 4.5 9-4.5M3 16l9 4.5 9-4.5" /></>,
  ward: <><path className="tb-t" d="M3 12.5h18v4H3z" /><path d="M3 18.5v-12M21 18.5v-4.5a2 2 0 0 0-2-2h-8v4.5M3 16.5h18" /><circle cx="7" cy="10" r="1.8" /></>,
  today: <><rect className="tb-t" x="3.5" y="5" width="17" height="15.5" rx="2.2" /><rect x="3.5" y="5" width="17" height="15.5" rx="2.2" /><path d="M3.5 9.5h17M8 3v4M16 3v4" /><circle className="tb-f" cx="12" cy="14.5" r="1.4" /></>,
  done: <><circle className="tb-t" cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="9" /><path d="M8 12.3l2.7 2.7 5.3-5.6" /></>,
  'copy-next': <><rect className="tb-t" x="3.5" y="5" width="13" height="14" rx="2" /><rect x="3.5" y="5" width="13" height="14" rx="2" /><path d="M3.5 9h13M7.5 3v3.5M12.5 3v3.5M14 17h7M18.2 13.8 21.4 17l-3.2 3.2" /></>,
  templates: <><rect className="tb-t" x="7.5" y="3.5" width="13" height="14" rx="2" /><rect x="7.5" y="3.5" width="13" height="14" rx="2" /><path d="M4.5 7v11.5a2 2 0 0 0 2 2H17M11 8h6M11 11.5h6M11 15h3.5" /></>,
  admin: <><rect className="tb-t" x="3.5" y="3.5" width="7.5" height="7.5" rx="2" /><rect className="tb-t" x="13" y="3.5" width="7.5" height="7.5" rx="2" /><rect className="tb-t" x="3.5" y="13" width="7.5" height="7.5" rx="2" /><rect className="tb-t" x="13" y="13" width="7.5" height="7.5" rx="2" /><rect x="3.5" y="3.5" width="7.5" height="7.5" rx="2" /><rect x="13" y="3.5" width="7.5" height="7.5" rx="2" /><rect x="3.5" y="13" width="7.5" height="7.5" rx="2" /><rect x="13" y="13" width="7.5" height="7.5" rx="2" /></>,
  home: <><path className="tb-t" d="M4.5 10.5 12 4l7.5 6.5V20h-15z" /><path d="M3 11.5 12 3.5l9 8M5.5 10v10h13V10M10 20v-5.5h4V20" /></>,
  account: <><circle className="tb-t" cx="12" cy="8.5" r="4" /><circle cx="12" cy="8.5" r="4" /><path className="tb-t" d="M4.5 20.5c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5z" /><path d="M4.5 20.5c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5" /></>,
  forms: <><rect className="tb-t" x="5" y="4.5" width="14" height="16" rx="2" /><rect x="5" y="4.5" width="14" height="16" rx="2" /><path d="M9 4.5V3.5h6v1M8.5 10h.01M11 10h4.5M8.5 13.5h.01M11 13.5h4.5M8.5 17h.01M11 17h4.5" /></>,
  warn: <><path className="tb-t" d="M12 3.5 2.8 19.5h18.4z" /><path d="M12 3.5 2.8 19.5h18.4zM12 10v4.5M12 17h.01" /></>,
  order: <>
    <path className="tb-t2" d="M12 3 3.6 7.2 12 11.4l8.4-4.2z" />
    <path className="tb-t" d="M3.6 7.2v9.4L12 21v-9.6zM12 21l8.4-4.4V7.2L12 11.4z" />
    <path d="M12 3 3.6 7.2v9.4L12 21l8.4-4.4V7.2zM3.6 7.2 12 11.4l8.4-4.2M12 11.4V21M7.8 5.1l8.4 4.2" />
  </>,
}

// A bare drawing for chips and labels (same family, sized by CSS).
export const Glyph = ({ icon }) => <svg className="tb-glyph" viewBox="0 0 24 24" aria-hidden="true">{ICONS[icon]}</svg>

// An icon-only button: the name is the accessible label and the tooltip (data-tip shows at once
// on hover, keyboard focus and press-and-hold). `busy` swaps the drawing for the app spinner.
export default function ToolbarButton({ icon, label, primary, busy, ...props }) {
  return (
    <button type="button" className={`${primary ? 'primary-button' : 'secondary-button'} tb-button`} aria-label={label} data-tip={label} {...props}>
      {busy ? <span className="spinner" aria-hidden="true" /> : <svg viewBox="0 0 24 24" aria-hidden="true">{ICONS[icon]}</svg>}
    </button>
  )
}
