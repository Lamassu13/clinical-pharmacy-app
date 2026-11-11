// The frame of a table-shaped screen while it loads: a few quiet rows instead of a lone spinner, so the
// page keeps its shape and nothing jumps when the data lands. The spoken "loading" stays with the caller.
export default function LoadingRows({ rows = 6 }) {
  return <div className="load-skeleton" aria-hidden="true">{Array.from({ length: rows }, (_, index) => <span key={index} className="skeleton-row" />)}</div>
}
