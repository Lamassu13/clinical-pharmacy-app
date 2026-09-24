import express from 'express'
import { query } from '../db.js'
import { requireManager } from '../auth.js'
import { ALLOWED_FLOORS, FLOOR_WARDS, SPECIAL_WARDS, SUPPLY_MATCH, SUPPLY_EXCEPT, isIsoDate } from '../validation.js'

const router = express.Router()

// التقارير: per-floor figures over a manager-chosen range. On demand only (no polling), and the
// range is capped like the dashboard's range table so one request can't read years of charts.
export const MAX_REPORT_DAYS = 120
const POLYPHARMACY_MIN = 5
const LONG_STAY_DAYS = 7

const DAY_MS = 86400000
const toDay = (iso) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS
const toIso = (day) => new Date(day * DAY_MS).toISOString().slice(0, 10)
const wardKey = (floor, ward) => `${floor ?? ''}|${ward}`
// Same whitespace normalisation the dashboard's totalPatients uses, so one patient typed with a
// stray double space is still one patient.
const PATIENT_SQL = "btrim(regexp_replace(cp.patient_name, '\\s+', ' ', 'g'))"
// A column's medicine is a supply per the catalogue flag, or — for a column whose medicine was
// deleted from the catalogue (medicine_id NULL, name kept in custom_name) — per the default patterns.
const SUPPLY_SQL = 'COALESCE(m.is_supply, cc.custom_name ~* $4 AND cc.custom_name !~* $5, FALSE)'

// scope: 'all', a floor number, or a special ward's name. Returns the wards it covers and the
// SQL filter on `wards w` ($3 is the scope value), or null when the scope is unknown.
const resolveScope = (scope) => {
  if (scope === 'all') {
    return {
      wards: [...ALLOWED_FLOORS.flatMap((floor) => FLOOR_WARDS[floor].map((ward) => ({ floor, ward }))), ...SPECIAL_WARDS.map((ward) => ({ floor: null, ward }))],
      sql: '$3::text IS NOT NULL', value: 'all',
    }
  }
  const floor = Number(scope)
  if (ALLOWED_FLOORS.includes(floor)) return { wards: FLOOR_WARDS[floor].map((ward) => ({ floor, ward })), sql: 'w.floor_number = $3::int', value: String(floor) }
  if (SPECIAL_WARDS.includes(scope)) return { wards: [{ floor: null, ward: scope }], sql: 'w.floor_number IS NULL AND w.name = $3::text', value: scope }
  return null
}

router.get('/reports', requireManager, async (request, response) => {
  const { from, to } = request.query
  if (!isIsoDate(from) || !isIsoDate(to)) return response.status(400).json({ message: 'التاريخ مطلوب' })
  if (from > to) return response.status(400).json({ message: 'تاريخ البداية بعد تاريخ النهاية' })
  const days = toDay(to) - toDay(from) + 1
  if (days > MAX_REPORT_DAYS) return response.status(400).json({ message: `المدة القصوى ${MAX_REPORT_DAYS} يومًا` })
  const scope = resolveScope(String(request.query.scope || 'all'))
  if (!scope) return response.status(400).json({ message: 'الطابق أو الردهة غير معروفة' })

  // The previous period of the same length, for ↑/↓ — and it also supplies "yesterday" for
  // day one's admissions and the start of any stay already running when the range begins.
  const previousFrom = toIso(toDay(from) - days)
  const previousTo = toIso(toDay(from) - 1)
  const params = [previousFrom, to, scope.value, SUPPLY_MATCH, SUPPLY_EXCEPT]

  const [patientRows, consumptionRows, chartRows, extraFormRows] = await Promise.all([
    // One row per patient per ward per day, main and extra charts merged, with how many distinct
    // non-supply medicines they had a quantity of that day.
    query(
      `SELECT w.floor_number AS floor, w.name AS ward, dc.chart_date::text AS date, ${PATIENT_SQL} AS patient,
              COUNT(DISTINCT CASE WHEN cq.quantity > 0 AND NOT ${SUPPLY_SQL} THEN lower(COALESCE(m.name, cc.custom_name)) END)::int AS medicines
       FROM chart_patients cp
       JOIN daily_charts dc ON dc.id = cp.chart_id
       JOIN wards w ON w.id = dc.ward_id
       LEFT JOIN chart_quantities cq ON cq.chart_id = cp.chart_id AND cq.row_number = cp.row_number
       LEFT JOIN chart_columns cc ON cc.chart_id = cq.chart_id AND cc.column_number = cq.column_number
       LEFT JOIN medicines m ON m.id = cc.medicine_id
       WHERE ${PATIENT_SQL} <> '' AND dc.chart_date BETWEEN $1::date AND $2::date AND ${scope.sql}
       GROUP BY 1, 2, 3, 4`,
      params,
    ),
    query(
      `SELECT w.floor_number AS floor, w.name AS ward, COALESCE(m.name, cc.custom_name) AS name,
              bool_or(${SUPPLY_SQL}) AS is_supply,
              COALESCE(SUM(cq.quantity) FILTER (WHERE dc.chart_date > $6::date), 0)::int AS quantity,
              COALESCE(SUM(cq.quantity) FILTER (WHERE dc.chart_date <= $6::date), 0)::int AS previous
       FROM chart_quantities cq
       JOIN chart_columns cc ON cc.chart_id = cq.chart_id AND cc.column_number = cq.column_number
       JOIN daily_charts dc ON dc.id = cq.chart_id
       JOIN wards w ON w.id = dc.ward_id
       LEFT JOIN medicines m ON m.id = cc.medicine_id
       WHERE cq.quantity > 0 AND dc.chart_date BETWEEN $1::date AND $2::date AND ${scope.sql}
       GROUP BY 1, 2, 3`,
      [...params, previousTo],
    ),
    // "Charted" means what the dashboard's startedWards means: a named patient and a quantity.
    query(
      `SELECT w.floor_number AS floor, w.name AS ward, dc.chart_date::text AS date, dc.slot,
              dc.completed_at IS NOT NULL AS completed,
              (EXISTS (SELECT 1 FROM chart_patients cp WHERE cp.chart_id = dc.id AND cp.patient_name <> '')
               AND EXISTS (SELECT 1 FROM chart_quantities cq WHERE cq.chart_id = dc.id AND cq.quantity > 0)) AS started
       FROM daily_charts dc
       JOIN wards w ON w.id = dc.ward_id
       WHERE dc.chart_date BETWEEN $1::date AND $2::date AND ${scope.sql}`,
      [previousTo, to, scope.value],
    ),
    // extra_pill_forms carries its own floor/ward (no wards row), so it's filtered directly.
    query(
      `SELECT floor_number AS floor, ward, COUNT(*)::int AS count
       FROM extra_pill_forms
       WHERE created_at >= $1::date AND created_at < $2::date + 1
         AND ($3::text = 'all' OR floor_number::text = $3::text)
       GROUP BY 1, 2`,
      [from, to, scope.value],
    ),
  ])

  const inRange = (date) => date >= from && date <= to
  const rangeDates = Array.from({ length: days }, (_, i) => toIso(toDay(from) + i))

  // wardKey -> date -> Map(patient -> medicines)
  const byWard = new Map()
  patientRows.rows.forEach((row) => {
    const key = wardKey(row.floor, row.ward)
    if (!byWard.has(key)) byWard.set(key, new Map())
    const dates = byWard.get(key)
    if (!dates.has(row.date)) dates.set(row.date, new Map())
    dates.get(row.date).set(row.patient, row.medicines)
  })
  const charted = new Map() // wardKey -> Set(date), main chart started
  const completed = new Map()
  const extraCharted = new Map()
  const addTo = (map, key, date) => { if (!map.has(key)) map.set(key, new Set()); map.get(key).add(date) }
  chartRows.rows.forEach((row) => {
    const key = wardKey(row.floor, row.ward)
    if (row.slot === 'extra') { if (row.started && inRange(row.date)) addTo(extraCharted, key, row.date); return }
    if (row.started) addTo(charted, key, row.date)
    if (row.completed && inRange(row.date)) addTo(completed, key, row.date)
  })
  const extraForms = new Map(extraFormRows.rows.map((row) => [wardKey(row.floor, row.ward), row.count]))

  const daily = new Map(rangeDates.map((date) => [date, { date, patients: 0, admissions: 0, discharges: 0 }]))
  const longStays = []
  const polypharmacy = new Map() // `${wardKey}|${patient}` -> entry
  const allPatients = new Set()
  const allPreviousPatients = new Set()
  let medicineSum = 0
  let stayCount = 0
  let staySum = 0

  const wards = scope.wards.map(({ floor, ward }) => {
    const key = wardKey(floor, ward)
    const dates = byWard.get(key) || new Map()
    const namesOn = (date) => dates.get(date) || new Map()
    const chartedDays = charted.get(key) || new Set()
    let patientDays = 0
    let previousPatientDays = 0
    let admissions = 0
    let discharges = 0
    const distinct = new Set()
    const previousDistinct = new Set()
    dates.forEach((patients, date) => {
      if (inRange(date)) {
        patientDays += patients.size
        daily.get(date).patients += patients.size
        patients.forEach((medicines, patient) => {
          distinct.add(patient); allPatients.add(patient)
          medicineSum += medicines
          if (medicines < POLYPHARMACY_MIN) return
          const entryKey = `${key}|${patient}`
          const current = polypharmacy.get(entryKey)
          if (!current || medicines > current.maxMedicines) polypharmacy.set(entryKey, { floor, ward, patient, maxMedicines: medicines, date })
        })
      } else if (date >= previousFrom && date <= previousTo) {
        previousPatientDays += patients.size
        patients.forEach((_, patient) => { previousDistinct.add(patient); allPreviousPatients.add(patient) })
      }
    })
    // Admissions/discharges only across two consecutive charted days — a day with no chart at
    // all would otherwise read as every patient discharged, then re-admitted the day after.
    rangeDates.forEach((date) => {
      const yesterday = toIso(toDay(date) - 1)
      if (!chartedDays.has(date) || !chartedDays.has(yesterday)) return
      const today = namesOn(date)
      const before = namesOn(yesterday)
      let admitted = 0
      let discharged = 0
      today.forEach((_, patient) => { if (!before.has(patient)) admitted += 1 })
      before.forEach((_, patient) => { if (!today.has(patient)) discharged += 1 })
      admissions += admitted; discharges += discharged
      daily.get(date).admissions += admitted
      daily.get(date).discharges += discharged
    })
    // Stays: runs of consecutive days with the same name on this ward. The fetched window starts
    // a full period early, so a stay already running on `from` keeps its earlier days.
    // ponytail: a transfer to another ward starts a new stay there; matching patients across
    // wards (same name, adjacent days) is the upgrade if that ever matters.
    const daysByPatient = new Map()
    dates.forEach((patients, date) => patients.forEach((_, patient) => {
      if (!daysByPatient.has(patient)) daysByPatient.set(patient, [])
      daysByPatient.get(patient).push(toDay(date))
    }))
    let wardStays = 0
    let wardStaySum = 0
    daysByPatient.forEach((dayList, patient) => {
      dayList.sort((a, b) => a - b)
      let start = dayList[0]
      dayList.forEach((day, index) => {
        const next = dayList[index + 1]
        if (next === day + 1) return
        const length = day - start + 1
        // Only stays that overlap the report range count.
        if (day >= toDay(from)) {
          wardStays += 1; wardStaySum += length
          if (day === toDay(to) && length >= LONG_STAY_DAYS) longStays.push({ floor, ward, patient, days: length, since: toIso(start) })
        }
        start = next
      })
    })
    stayCount += wardStays; staySum += wardStaySum
    const chartedInRange = rangeDates.filter((date) => chartedDays.has(date))
    return {
      floor, ward, patientDays, previousPatientDays,
      distinctPatients: distinct.size, previousDistinctPatients: previousDistinct.size,
      admissions, discharges,
      averageStay: wardStays ? Math.round((wardStaySum / wardStays) * 10) / 10 : null,
      chartedDays: chartedInRange.length,
      completedDays: (completed.get(key) || new Set()).size,
      missedDates: rangeDates.filter((date) => !chartedDays.has(date)),
      extraChartDays: (extraCharted.get(key) || new Set()).size,
      extraPillForms: extraForms.get(key) || 0,
    }
  })

  // Consumption over the whole scope, one line per medicine (names matched ignoring case/spaces).
  const medicines = new Map()
  const dosesByWard = new Map()
  consumptionRows.rows.forEach((row) => {
    if (!row.name) return
    const key = row.name.trim().replace(/\s+/g, ' ').toLowerCase()
    const line = medicines.get(key) || { name: row.name, isSupply: row.is_supply, quantity: 0, previous: 0 }
    line.quantity += row.quantity; line.previous += row.previous
    medicines.set(key, line)
    if (!row.is_supply) dosesByWard.set(wardKey(row.floor, row.ward), (dosesByWard.get(wardKey(row.floor, row.ward)) || 0) + row.quantity)
  })
  const change = (now, before) => (before ? Math.round(((now - before) / before) * 100) : null)
  const consumption = [...medicines.values()]
    .filter((line) => line.quantity > 0 || line.previous > 0)
    .map((line) => ({ ...line, change: change(line.quantity, line.previous) }))
    .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name))

  // Floor comparison: numbered floors summed across their wards, each special ward on its own.
  const floorsMap = new Map()
  wards.forEach((row) => {
    const key = row.floor ?? row.ward
    const entry = floorsMap.get(key) || { floor: row.floor, ward: row.floor === null ? row.ward : null, patientDays: 0, doses: 0 }
    entry.patientDays += row.patientDays
    entry.doses += dosesByWard.get(wardKey(row.floor, row.ward)) || 0
    floorsMap.set(key, entry)
  })
  const floors = [...floorsMap.values()].map((entry) => ({
    ...entry, dosesPerPatient: entry.patientDays ? Math.round((entry.doses / entry.patientDays) * 10) / 10 : null,
  }))

  const sum = (field) => wards.reduce((total, row) => total + row[field], 0)
  const patientDays = sum('patientDays')
  const doses = [...dosesByWard.values()].reduce((a, b) => a + b, 0)
  const previousDoses = consumption.filter((line) => !line.isSupply).reduce((total, line) => total + line.previous, 0)
  const polypharmacyPatients = [...polypharmacy.values()].sort((a, b) => b.maxMedicines - a.maxMedicines || a.patient.localeCompare(b.patient, 'ar'))

  response.json({
    range: { from, to, days, previousFrom, previousTo },
    thresholds: { polypharmacy: POLYPHARMACY_MIN, longStay: LONG_STAY_DAYS },
    summary: {
      patientDays, previousPatientDays: sum('previousPatientDays'),
      distinctPatients: allPatients.size, previousDistinctPatients: allPreviousPatients.size,
      admissions: sum('admissions'), discharges: sum('discharges'),
      averageStay: stayCount ? Math.round((staySum / stayCount) * 10) / 10 : null,
      averageMedicines: patientDays ? Math.round((medicineSum / patientDays) * 10) / 10 : null,
      polypharmacyPatients: polypharmacyPatients.length,
      doses, previousDoses,
      chartedDays: sum('chartedDays'), possibleChartDays: wards.length * days,
      completedDays: sum('completedDays'),
      extraChartDays: sum('extraChartDays'), extraPillForms: sum('extraPillForms'),
    },
    wards,
    floors,
    daily: [...daily.values()],
    longStays: longStays.sort((a, b) => b.days - a.days),
    polypharmacy: polypharmacyPatients,
    consumption,
  })
})

export default router
