import { useEffect, useState } from 'react'
import { apiUrl } from '../constants.js'
import { ChevronStart, CardStatus } from '../components/WardGlyph.jsx'
import { CHART_ITEMS, GROUPS, Icon } from '../components/wardOptions.jsx'

// Request forms counted for the day, worded for the row: 1 and 2 are special in Arabic, 3-10 take the
// plural, 11+ the singular again.
const formsWord = (n) => (n === 1 ? 'استمارة واحدة' : n === 2 ? 'استمارتان' : `${n} ${n <= 10 ? 'استمارات' : 'استمارة'}`)

// One ward's own page: what it offers, one tap each. «الجارت» is the page's single primary action and
// stays solid whether or not the ward has started (it is the button a pharmacist comes back to all
// round; the pill and the word «متابعة» say which state it is); the other chart (إدخال مريض,
// الجارت الإضافي) sits right under it, then the two groups. `floor` is a number for a sub-ward, null for
// an independent ward. Back returns to wherever the ward was picked from (the floor's ward list, or the
// floors). The two request-form rows show how many forms the ward has for the day; offline, or before
// the count arrives, they show nothing rather than a guess.
export default function WardHubScreen({ floor, ward, selectedDate, weekday, started, isOnline, isExpired, dashboard, dashboardError, onBack, onOpen }) {
  // A ward card low on the list opens this page at its scroll position; start at the top.
  useEffect(() => { window.scrollTo(0, 0) }, [ward])
  // Kept with the ward and day it was asked for, so a slower answer for another ward is never shown here.
  const key = `${floor || ''}|${ward}|${selectedDate}`
  const [loaded, setLoaded] = useState(null)
  const counts = isOnline && loaded?.key === key ? loaded.counts : null
  useEffect(() => {
    if (!isOnline) return undefined
    let cancelled = false
    const params = new URLSearchParams({ floor: floor || '', ward, date: selectedDate })
    fetch(`${apiUrl}/drug-requests/counts?${params}`, { credentials: 'include' })
      .then((response) => { isExpired(response); return response.ok ? response.json() : null })
      .then((result) => { if (!cancelled && result) setLoaded({ key, counts: result }) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [key, floor, ward, selectedDate, isOnline, isExpired])
  // One digit system on the page (the floor is Latin): «الخميس 5/11».
  const [, month, day] = selectedDate.split('-')
  const dateText = `${weekday} ${Number(day)}/${Number(month)}`
  const open = (extra) => onOpen({ floor, ward, ...extra })
  const row = (item) => <li key={item.label}>
    <button type="button" className="ward-menu-item" onClick={() => open(item.open)}>
      <Icon name={item.icon} />
      <span>{item.label}</span>
      {!isOnline && item.needsConnection && <span className="card-status card-status--muted">يتطلب اتصالاً</span>}
      {item.count && counts?.[item.count] > 0 && <span className="card-status card-status--partial">{formsWord(counts[item.count])}</span>}
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
        <p className="ward-hub-meta">{floor ? `الطابق ${floor}` : 'ردهة مستقلة'} · {dateText}</p>
      </div>
    </div>
    <button className="primary-button ward-hub-chart" onClick={() => open({ mode: 'chart', slot: 'main' })}>
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
