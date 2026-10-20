// Wards make no chart on Friday — Thursday's chart carries the doses for it. A day without a
// chart says nothing, so a patient on the last charted day before such a gap and on the next
// charted day was on the ward through it: not discharged, and the days count. Up to this many
// days in a row (Friday, a Friday + holiday); a longer silence is not bridged.
export const MAX_BRIDGE_DAYS = 3

const DAY_MS = 86400000
const toDay = (iso) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS
const toIso = (day) => new Date(day * DAY_MS).toISOString().slice(0, 10)

// Patients per floor (or special ward) per day, counting a patient on the uncharted days
// between two charted ones (Friday) like the Reports page does. `rows` are one per ward, chart
// day and patient (`patient` null for a chart with nobody on it) and must reach MAX_BRIDGE_DAYS
// past `from`/`to` so the edges can be bridged; only days in [from, to] are returned.
export const bridgedDailyCounts = (rows, from, to) => {
  const wards = new Map() // ward id -> { floor, ward, days: Map(day -> Set(patient)) }
  rows.forEach(({ wardId, floor, ward, date, patient }) => {
    const entry = wards.get(wardId) || { floor, ward, days: new Map() }
    const names = entry.days.get(toDay(date)) || new Set()
    if (patient) names.add(patient)
    entry.days.set(toDay(date), names)
    wards.set(wardId, entry)
  })
  const [lo, hi] = [toDay(from), toDay(to)]
  const totals = new Map() // `${floor ?? ward}|${date}` -> { floor, ward, date, count }
  wards.forEach(({ floor, ward, days }) => {
    const known = [...days.keys()].sort((a, b) => a - b)
    const add = (day, count) => {
      if (day < lo || day > hi || !count) return
      const key = `${floor ?? ward}|${day}`
      const total = totals.get(key) || { floor, ward: floor == null ? ward : null, date: toIso(day), count: 0 }
      total.count += count
      totals.set(key, total)
    }
    known.forEach((day, i) => {
      add(day, days.get(day).size)
      const next = known[i + 1]
      if (next === undefined || next - day - 1 > MAX_BRIDGE_DAYS) return
      const after = days.get(next)
      const bridged = [...days.get(day)].filter((patient) => after.has(patient)).length
      for (let gap = day + 1; gap < next; gap += 1) add(gap, bridged)
    })
  })
  return [...totals.values()].sort((a, b) => (a.floor ?? Infinity) - (b.floor ?? Infinity) || String(a.ward).localeCompare(String(b.ward)) || a.date.localeCompare(b.date))
}
