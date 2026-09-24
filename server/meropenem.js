// «استمارة متابعة الميروبينيم» — derived entirely from saved charts, nothing stored. Pure, so
// the course / D-number rules can be tested without a database (see meropenem.test.js).

export const MEROPENEM_SQL_PATTERN = '(meronem|meropenem)'
// How far before the month's first day to look, so a course already running on the 1st keeps
// its real D-number instead of restarting at D1.
export const LOOKBACK_DAYS = 60

const DAY_MS = 86400000
const toDay = (iso) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS)
const toIso = (day) => new Date(day * DAY_MS).toISOString().slice(0, 10)
const nameKey = (value) => String(value ?? '').trim().replace(/\s+/g, ' ')

export const monthStart = (iso) => `${iso.slice(0, 8)}01`
export const windowStart = (iso) => toIso(toDay(monthStart(iso)) - LOOKBACK_DAYS)

// Vial strength in mg: "Meronem 1000gm Vial" → 1000, "Meronem 500gm Vial" → 500. The catalogue
// writes gm where it means mg, so only a small number with a plain "g" ("1g") is read as grams.
export const strengthMg = (medicine) => {
  const match = String(medicine).match(/(\d+(?:\.\d+)?)\s*(mg|gm|g)\b/i)
  if (!match) return 0
  const value = Number(match[1])
  return match[2].toLowerCase() === 'g' && value < 10 ? value * 1000 : value
}
const formatMg = (mg) => (mg >= 1000 ? `${mg / 1000}g` : `${mg}mg`)

// Meropenem is given three times a day, so a quantity that divides by 3 reads as a per-dose
// amount: 1g vial × 6 → "2g × 3", 500mg × 3 → "500mg × 3". Anything else stays as vials × count.
export const doseText = (medicine, quantity) => {
  const mg = strengthMg(medicine)
  if (!mg) return `× ${quantity}`
  return quantity % 3 === 0 ? `${formatMg(mg * quantity / 3)} × 3` : `${formatMg(mg)} × ${quantity}`
}

const wardKeyOf = (floor, ward) => `${floor ?? ''}|${ward}`
const wardLabelOf = (floor, ward) => (floor ? `الطابق ${floor} — ${ward}` : ward)

// cells:    [{ date, floor, ward, name, patientId, medicine, quantity }] — Meronem cells with a
//           quantity, hospital-wide (a patient may have been dosed on another ward first).
// presence: [{ date, floor, ward, name, patientId }] — named chart rows on this ward, plus rows
//           anywhere carrying an ID seen in `cells`.
// charted:  [{ date, floor, ward }] — the days each ward has a chart with a named patient.
// All over the lookback window. Returns this ward's rows for the month of `date`, up to `date`.
export const buildMeropenemForm = ({ date, floor, ward, cells, presence, charted }) => {
  const here = wardKeyOf(floor, ward)
  const chartedByWard = new Map()
  charted.forEach((row) => {
    const key = wardKeyOf(row.floor, row.ward)
    if (!chartedByWard.has(key)) chartedByWard.set(key, new Set())
    chartedByWard.get(key).add(row.date)
  })
  const isCharted = (wardKey, iso) => chartedByWard.get(wardKey)?.has(iso) ?? false

  // Patient key: the ID; else the ID the same name carries on the same ward (typed on one day,
  // added the next); else the name, which only ever matches on that one ward.
  const idByWardName = new Map()
  ;[...cells, ...presence].forEach((row) => {
    if (row.patientId) idByWardName.set(`${wardKeyOf(row.floor, row.ward)}|${nameKey(row.name)}`, row.patientId)
  })
  const keyOf = (row) => {
    const wardKey = wardKeyOf(row.floor, row.ward)
    const id = row.patientId || idByWardName.get(`${wardKey}|${nameKey(row.name)}`)
    return id ? `id:${id}` : `name:${wardKey}|${nameKey(row.name)}`
  }

  const patients = new Map() // key -> { name, patientId, doses: Map(date -> [{ wardKey, text }]), seen: Map(date -> Set(wardKey)) }
  const patientOf = (key) => {
    if (!patients.has(key)) patients.set(key, { name: '', patientId: '', doses: new Map(), seen: new Map() })
    return patients.get(key)
  }
  cells.forEach((cell) => {
    const patient = patientOf(keyOf(cell))
    // Rows arrive date-ordered, so the latest name / ID wins.
    if (nameKey(cell.name)) patient.name = nameKey(cell.name)
    if (cell.patientId) patient.patientId = cell.patientId
    if (!patient.doses.has(cell.date)) patient.doses.set(cell.date, [])
    patient.doses.get(cell.date).push({ wardKey: wardKeyOf(cell.floor, cell.ward), text: doseText(cell.medicine, cell.quantity) })
  })
  presence.forEach((row) => {
    const patient = patients.get(keyOf(row))
    if (!patient) return // never on Meronem — not this form's business
    if (!patient.seen.has(row.date)) patient.seen.set(row.date, new Set())
    patient.seen.get(row.date).add(wardKeyOf(row.floor, row.ward))
  })

  const first = monthStart(date)
  const hereCharted = [...(chartedByWard.get(here) || [])].filter((iso) => iso <= date).sort()
  const latestCharted = hereCharted[hereCharted.length - 1]
  const wardLabels = new Map(presence.map((row) => [wardKeyOf(row.floor, row.ward), wardLabelOf(row.floor, row.ward)]))

  const rows = []
  patients.forEach((patient) => {
    const doseDates = [...patient.doses.keys()].sort()
    // Course walk, calendar day by calendar day. A dose day counts. An off-day — on some chart
    // without Meronem, or absent while their ward charted — is held as pending; so is a day their
    // ward has no chart at all (Friday). At the next dose: at most one off-day in between is a
    // charting slip, forgiven and flagged; two or more mean the course ended, so restart at D1.
    const days = new Map() // iso -> { n, wardKey, missed }
    let start = null
    let currentWard = null
    let pending = []
    for (let day = toDay(doseDates[0]); day <= toDay(doseDates[doseDates.length - 1]); day += 1) {
      const iso = toIso(day)
      const doses = patient.doses.get(iso)
      if (doses) {
        const offDays = pending.filter((entry) => entry.off).length
        if (start === null || offDays > 1) start = day
        else pending.forEach((entry) => days.set(entry.iso, { n: entry.day - start + 1, wardKey: entry.wardKey, missed: entry.off }))
        pending = []
        currentWard = (doses.find((dose) => dose.wardKey === here) || doses[0]).wardKey
        days.set(iso, { n: day - start + 1, wardKey: currentWard, missed: false })
      } else {
        const off = patient.seen.has(iso) || isCharted(currentWard, iso)
        pending.push({ iso, day, wardKey: currentWard, off })
      }
    }

    const hereDoseDates = doseDates.filter((iso) => iso >= first && patient.doses.get(iso).some((dose) => dose.wardKey === here))
    if (!hereDoseDates.length) return
    const lastHere = hereDoseDates[hereDoseDates.length - 1]
    const shown = [...days].filter(([iso, entry]) => iso >= first && entry.wardKey === here)

    let status = { kind: 'active' }
    if (latestCharted && lastHere < latestCharted) {
      const next = hereCharted.find((iso) => iso > lastHere)
      const elsewhere = [...patient.seen].filter(([iso]) => iso > lastHere).sort(([a], [b]) => a.localeCompare(b))
        .map(([, wards]) => [...wards].find((wardKey) => wardKey !== here)).find(Boolean)
      if (patient.seen.get(next)?.has(here)) status = { kind: 'stopped' }
      else if (patient.patientId && elsewhere) status = { kind: 'transferred', to: wardLabels.get(elsewhere) }
      else status = { kind: 'left' }
    }

    rows.push({
      name: patient.name,
      patientId: patient.patientId,
      dose: patient.doses.get(lastHere).filter((dose) => dose.wardKey === here).map((dose) => dose.text).join(' + '),
      days: Object.fromEntries(shown.map(([iso, entry]) => [iso, entry.n])),
      missed: shown.filter(([, entry]) => entry.missed).map(([iso]) => iso),
      status,
      firstDay: hereDoseDates[0],
    })
  })
  rows.sort((a, b) => a.firstDay.localeCompare(b.firstDay) || a.name.localeCompare(b.name, 'ar'))
  return { patients: rows.map(({ firstDay: _firstDay, ...rest }) => rest) }
}
