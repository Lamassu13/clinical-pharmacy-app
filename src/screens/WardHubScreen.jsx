import { useEffect } from 'react'
import { ChevronStart, CardStatus } from '../components/WardGlyph.jsx'
import { CHART_ITEMS, GROUPS, Icon } from '../components/wardOptions.jsx'

// One ward's own page: what it offers, one tap each. «الجارت» is the page's single primary action
// (a solid fill only ever means "this ward hasn't started", so once it has, it steps down to a
// secondary «متابعة الجارت»); the other chart (إدخال مريض, الجارت الإضافي) sits right under it, then the
// two groups. `floor` is a number for a sub-ward, null for an independent ward. Back returns to
// wherever the ward was picked from (the floor's ward list, or the floors).
export default function WardHubScreen({ floor, ward, today, started, isOnline, dashboard, dashboardError, onBack, onOpen }) {
  // A ward card low on the list opens this page at its scroll position; start at the top.
  useEffect(() => { window.scrollTo(0, 0) }, [ward])
  const open = (extra) => onOpen({ floor, ward, ...extra })
  const row = (item) => <li key={item.label}>
    <button type="button" className="ward-menu-item" onClick={() => open(item.open)}>
      <Icon name={item.icon} />
      <span>{item.label}</span>
      {!isOnline && item.needsConnection && <span className="card-status card-status--muted">يتطلب اتصالاً</span>}
      <span className="arrow" aria-hidden="true"><ChevronStart /></span>
    </button>
  </li>
  return <section className="dashboard ward-hub">
    <button className="back-button" onClick={onBack}><span aria-hidden="true">→</span> {floor ? 'العودة للردهات' : 'العودة للطوابق'}</button>
    <div className="section-heading ward-hub-head">
      <div>
        <div className="ward-hub-title">
          <h1>{ward}</h1>
          {dashboard ? <CardStatus started={started} /> : dashboardError && <CardStatus unavailable />}
        </div>
        <p className="ward-hub-meta">{floor ? `الطابق ${floor}` : 'ردهة مستقلة'}{today && ` · اليوم ${today}`}</p>
      </div>
    </div>
    <button className={`${started ? 'secondary-button' : 'primary-button'} ward-hub-chart`} onClick={() => open({ mode: 'chart', slot: 'main' })}>
      <Icon name="grid" /> <span>{started ? 'متابعة الجارت' : 'الجارت'}</span>
    </button>
    <div className="ward-hub-pair">
      {CHART_ITEMS.map((item) => <button key={item.label} type="button" className="secondary-button ward-hub-chart-more" onClick={() => open(item.open)}>
        <Icon name={item.icon} /> <span>{item.label}</span>
      </button>)}
    </div>
    <div className="ward-hub-groups">
      {GROUPS.map((group) => {
        const items = group.items.filter((item) => !item.show || item.show(floor))
        return <section key={group.id} className="ward-hub-group" aria-labelledby={`ward-hub-${group.id}`}>
          <h2 className="ward-hub-label" id={`ward-hub-${group.id}`}>{group.label}</h2>
          <ul className="ward-hub-list" role="list" aria-labelledby={`ward-hub-${group.id}`}>{items.map(row)}</ul>
        </section>
      })}
    </div>
  </section>
}
