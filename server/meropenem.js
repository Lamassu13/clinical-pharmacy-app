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

// cells: [{ date, name, patientId, medicine, quantity }] — Meronem cells with quantity > 0, over
// the lookback window. chartedDates: every date in the window this ward has a chart with at least
// one named patient. Returns { dates, patients } for the month of `date`, up to `date`.
export const buildMeropenemForm = ({ date, cells, chartedDates }) => {
  const charted = new Set(chartedDates)
  // A name typed without an ID on one day and with it on another is still one patient.
  const idByName = new Map()
  cells.forEach((cell) => { if (cell.patientId) idByName.set(nameKey(cell.name), cell.patientId) })
  const keyOf = (cell) => {
    const id = cell.patientId || idByName.get(nameKey(cell.name))
    return id ? `id:${id}` : `name:${nameKey(cell.name)}`
  }

  const byPatient = new Map() // key -> { name, patientId, doses: Map(date -> [strength × qty]) }
  cells.forEach((cell) => {
    const key = keyOf(cell)
    if (!byPatient.has(key)) byPatient.set(key, { name: '', patientId: '', doses: new Map() })
    const patient = byPatient.get(key)
    // Latest name / ID wins — cells arrive date-ordered.
    if (nameKey(cell.name)) patient.name = nameKey(cell.name)
    if (cell.patientId) patient.patientId = cell.patientId
    if (!patient.doses.has(cell.date)) patient.doses.set(cell.date, [])
    patient.doses.get(cell.date).push(doseText(cell.medicine, cell.quantity))
  })

  const first = monthStart(date)
  const dates = []
  for (let day = toDay(first); day <= toDay(date); day += 1) dates.push(toIso(day))

  const patients = []
  byPatient.forEach((patient) => {
    const onDays = [...patient.doses.keys()].sort()
    // Walk day by day from the first Meronem date. A charted day without Meronem ends the
    // course; a day with no chart at all (Friday) keeps counting.
    const days = {}
    let start = null
    const last = toDay(onDays[onDays.length - 1])
    for (let day = toDay(onDays[0]); day <= Math.min(last, toDay(date)); day += 1) {
      const iso = toIso(day)
      if (patient.doses.has(iso)) {
        if (start === null) start = day
        days[iso] = day - start + 1
      } else if (charted.has(iso)) {
        start = null
      } else if (start !== null) {
        days[iso] = day - start + 1
      }
    }
    // Only days inside the month are shown (the walk already stops at the last dose).
    const shown = Object.fromEntries(Object.entries(days).filter(([iso]) => iso >= first))
    const monthDoseDays = onDays.filter((iso) => iso >= first && iso <= date)
    if (!monthDoseDays.length) return
    patients.push({
      name: patient.name,
      patientId: patient.patientId,
      dose: patient.doses.get(monthDoseDays[monthDoseDays.length - 1]).join(' + '),
      days: shown,
      firstDay: monthDoseDays[0],
    })
  })
  patients.sort((a, b) => a.firstDay.localeCompare(b.firstDay) || a.name.localeCompare(b.name, 'ar'))
  // Only the days some patient is actually on it — an empty date column is just noise.
  const used = new Set(patients.flatMap((patient) => Object.keys(patient.days)))
  return { dates: dates.filter((iso) => used.has(iso)), patients: patients.map(({ firstDay: _firstDay, ...rest }) => rest) }
}
