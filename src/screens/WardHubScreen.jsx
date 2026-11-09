import { useEffect, useState } from 'react'
import { formsBadge, formsWord, isoDate } from '../helpers.js'
import { Glyph } from '../components/ToolbarIcons.jsx'
import { ChevronStart, CardStatus } from '../components/WardGlyph.jsx'
import { CHART_ITEMS, GROUPS, Icon } from '../components/wardOptions.jsx'

// One ward's own page: what it offers, one tap each. «الجارت» is the page's single primary action and
// stays solid whether or not the ward has started (it is the button a pharmacist comes back to all
// round; the pill and the word «متابعة» say which state it is); the other chart (إدخال مريض,
// الجارت الإضافي) sits right under it, then the two groups. `floor` is a number for a sub-ward, null for
// an independent ward. Back returns to wherever the ward was picked from (the floor's ward list, or the
// floors). The two request-form rows show how many forms the ward has for the day (`counts`, from
// useRequestCounts); offline, or before the count arrives, they show nothing rather than a guess.
// The two groups are drop-downs (native <details>: the lists were long), closed until opened; which are open is
// remembered on this device, and a closed group still shows how many forms its rows hold for the day.
const OPEN_KEY = 'ward-hub-open'
const readOpen = () => { try { return JSON.parse(localStorage.getItem(OPEN_KEY)) || {} } catch { return {} } }
export default function WardHubScreen({ floor, ward, selectedDate, weekday, counts, started, isOnline, dashboard, dashboardError, onBack, onOpen }) {
  // A ward card low on the list opens this page at its scroll position; start at the top.
  useEffect(() => { window.scrollTo(0, 0) }, [ward])
  const [openGroups, setOpenGroups] = useState(readOpen)
  const toggleGroup = (id, isOpen) => setOpenGroups((current) => {
    const next = { ...current, [id]: isOpen }
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(next)) } catch { /* private window: it just starts closed next time */ }
    return next
  })
  // One digit system on the page (the floor is Latin): «الخميس 5/11».
  const [, month, day] = selectedDate.split('-')
  const dateText = `${weekday} ${Number(day)}/${Number(month)}`
  const open = (extra) => onOpen({ floor, ward, ...extra })
  const badge = (kind) => formsBadge(counts, kind)
  // Today's forms still to follow up on this ward (the counts' `attention`, already loaded for the rows' badges) — a past day is not an alert.
  const isToday = selectedDate === isoDate(new Date())
  const attentionTotal = isToday ? Object.values(counts?.attention ?? {}).reduce((sum, n) => sum + n, 0) : 0
  const row = (item) => <li key={item.label}>
    <button type="button" className="ward-menu-item" onClick={() => open(item.open)}>
      <Icon name={item.icon} />
      <span>{item.label}</span>
      {!isOnline && item.needsConnection && <span className="card-status card-status--muted">يتطلب اتصالاً</span>}
      {item.count && badge(item.count) && <span className={`card-status card-status--${badge(item.count).tone}`}>{badge(item.count).text}</span>}
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
    {attentionTotal > 0 && <button type="button" className="forms-pending-link" onClick={() => toggleGroup('forms', true)}>
      <Glyph icon="warn" /><strong>{formsWord(attentionTotal)} تحتاج متابعة اليوم</strong><small>افتح «الاستمارات اليومية»</small>
    </button>}
    <div className="ward-hub-groups">
      {GROUPS.map((group) => {
        const items = group.items.filter((item) => !item.show || item.show(floor))
        const groupBadge = formsBadge(counts, items.filter((item) => item.count).map((item) => item.count))
        const isOpen = Boolean(openGroups[group.id])
        return <details key={group.id} className="ward-hub-group" open={isOpen} onToggle={(event) => { if (event.currentTarget.open !== isOpen) toggleGroup(group.id, event.currentTarget.open) }}>
          <summary className="ward-hub-label">
            <span>{group.label}</span>
            {!isOpen && groupBadge && <span className={`card-status card-status--${groupBadge.tone}`}>{groupBadge.text}</span>}
            <span className="ward-hub-chevron" aria-hidden="true"><ChevronStart /></span>
          </summary>
          <ul className="ward-hub-list" role="list">{items.map(row)}</ul>
        </details>
      })}
    </div>
  </section>
}
