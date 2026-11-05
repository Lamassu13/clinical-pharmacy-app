import { useEffect } from 'react'
import { ChevronStart, CardStatus } from '../components/WardGlyph.jsx'
import { GROUPS, Icon } from '../components/wardOptions.jsx'

// One ward's own page: what it offers, one tap each. «الجارت» is the page's single primary action;
// the two groups below are the rest. `floor` is a number for a sub-ward, null for an independent
// ward. Back returns to wherever the ward was picked from (the floor's ward list, or the floors).
export default function WardHubScreen({ floor, ward, today, started, dashboard, dashboardError, onBack, onOpen }) {
  // A ward card low on the list opens this page at its scroll position; start at the top.
  useEffect(() => { window.scrollTo(0, 0) }, [ward])
  const open = (extra) => onOpen({ floor, ward, ...extra })
  return <section className="dashboard ward-hub">
    <button className="back-button" onClick={onBack}>{floor ? '→ العودة للردهات' : '→ العودة للطوابق'}</button>
    <div className="section-heading">
      <div>
        <h1>{ward}</h1>
        {floor ? <p className="ward-hub-floor">الطابق {floor}</p> : <p className="ward-hub-floor">ردهة مستقلة</p>}
      </div>
      <div className="section-heading-actions">
        {dashboard ? <CardStatus started={started} /> : dashboardError && <CardStatus unavailable />}
        {today && <div className="date-chip"><span>اليوم</span><strong>{today}</strong></div>}
      </div>
    </div>
    <button className="primary-button ward-hub-chart" onClick={() => open({ mode: 'chart', slot: 'main' })}>
      <Icon name="sheet-plus" /> <span>الجارت</span>
    </button>
    <div className="ward-hub-groups">
      {GROUPS.map((group) => {
        const items = group.items.filter((item) => !item.show || item.show(floor))
        return <section key={group.id} className="ward-hub-group" aria-labelledby={`ward-hub-${group.id}`}>
          <h2 className="ward-hub-label" id={`ward-hub-${group.id}`}>{group.label}</h2>
          <div className="ward-hub-list">
            {items.map((item) => <button key={item.label} type="button" className="ward-menu-item" onClick={() => open(item.open)}>
              <Icon name={item.icon} />
              <span>{item.label}</span>
              <span className="arrow" aria-hidden="true"><ChevronStart /></span>
            </button>)}
          </div>
        </section>
      })}
    </div>
  </section>
}
