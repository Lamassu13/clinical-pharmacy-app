// Shared line icons for the floor / ward pickers. Same 1.75 stroke and soft 0.14 fill as
// the dashboard-widget icons so the two picker screens read as one system: a bed marks a
// ward, a chevron marks a whole-card link (a floor you drill into).

export function WardGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 13h18v4" fill="currentColor" fillOpacity="0.14" stroke="none" />
      <path d="M3 8v9" />
      <path d="M21 17v-4H3" />
      <path d="M6 13v-1.5A1.5 1.5 0 0 1 7.5 10h3A1.5 1.5 0 0 1 12 11.5V13" />
    </svg>
  )
}

export function ChevronStart() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 6l-6 6 6 6" />
    </svg>
  )
}
