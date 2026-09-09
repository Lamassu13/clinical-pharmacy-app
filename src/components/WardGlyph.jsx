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

// The tick on a ward whose chart has started today — same stroke family as the glyphs above.
export function StatusCheck() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  )
}

// The started marker on a picker card, shown to everyone now (a pharmacist mid-round needs
// "did I already do this ward?" as much as a manager does). A worded/amber-vs-green pill, not
// a colour dot. Pass `done`/`total` for a floor — a fraction across its sub-wards, "اكتملت"
// only when every one has started; pass `started` for a single ward.
export function CardStatus({ started, done, total, unavailable }) {
  if (unavailable) return <span className="card-status card-status--muted">الحالة غير متاحة</span>
  if (total != null) {
    if (done === total) return <span className="card-status card-status--done"><StatusCheck /> اكتملت</span>
    // A floor with some wards started reads differently from one nobody has touched.
    const cls = done > 0 ? 'card-status card-status--partial' : 'card-status card-status--pending'
    return <span className={cls} aria-label={`بدأت ${done} من ${total} من أروقة الطابق`}>{done}/{total}</span>
  }
  return started
    ? <span className="card-status card-status--done"><StatusCheck /> بدأت</span>
    : <span className="card-status card-status--pending">لم تبدأ</span>
}
