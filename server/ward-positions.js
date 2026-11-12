// «مواقف القسم»: one row per Meropenem course started in a date range, from the saved charts (who,
// where, when, how much) and «استمارة الميرونيم» (sex, age, diagnosis). Pure, so the rules can be
// tested without a database (see ward-positions.test.js); the route does the reading.
import { DRUG_REQUESTS } from '../shared/drug-requests.js'
import { inferDose, strengthMg } from '../shared/dose.js'

const DAY_MS = 86400000
const toDay = (iso) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS)
const toIso = (day) => new Date(day * DAY_MS).toISOString().slice(0, 10)
export const nameKey = (value) => String(value ?? '').trim().replace(/\s+/g, ' ')

// A form saved up to this many days after the course began still counts as that course's form:
// the popup is skippable («لاحقًا») and completed later from the form's screen.
export const FORM_GRACE_DAYS = 14

// Each calendar month the range touches, as the date to build that month's courses for: the month's
// last day, or `to` in the last one. (The course engine only shows days from the 1st of `date`'s month.)
export const monthDates = (from, to) => {
  const dates = []
  let [year, month] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))]
  for (;;) {
    const last = toIso(Date.UTC(year, month, 1) / DAY_MS - 1) // day 0 of the next month
    dates.push(last < to ? last : to)
    if (last >= to) return dates
    month += 1
    if (month > 12) { month = 1; year += 1 }
  }
}

// The days a patient's course began (course day D1) within [from, to].
export const startDates = (patient, from, to) => Object.entries(patient.days || {})
  .filter(([iso, n]) => n === 1 && iso >= from && iso <= to).map(([iso]) => iso).sort()

// Is this chart row (or form) the course's patient? Two IDs decide it by themselves: a namesake with
// another ID is someone else. Otherwise it is the same name on the same ward.
export const samePatient = (a, b) => (a.patientId && b.patientId
  ? a.patientId === b.patientId
  : nameKey(a.name) === nameKey(b.name) && a.floor === b.floor && a.ward === b.ward)

// Meronem mg given to this patient on this ward and day, main and extra charts together.
export const totalMgOn = (cells, course, iso) => cells
  .filter((cell) => cell.date === iso && cell.floor === course.floor && cell.ward === course.ward && samePatient(cell, course))
  .reduce((sum, cell) => sum + strengthMg(cell.medicine) * Number(cell.quantity || 0), 0)

// The day's total the dose is read from: the second day of the course when it was dosed, since the
// first is often a part day (two vials before the next round, say); else the first.
export const courseMg = (cells, course, start) => totalMgOn(cells, course, toIso(toDay(start) + 1)) || totalMgOn(cells, course, start)

// How long the patient has been on the charts up to the course start, counting the start as day 1:
// the run of days seen on any chart, one missing day (a Friday with no chart, a slip) forgiven, two
// in a row end it — so an earlier admission, or a namesake, is not counted. `capped` when the run
// reaches the far end of what was read (it began at least that many days ago).
export const stayRun = (seenDates, start, readFrom) => {
  const dates = [...new Set(seenDates)].filter((iso) => iso <= start).sort().reverse()
  let first = start
  for (const iso of dates) {
    if (iso >= first) continue
    if (toDay(first) - toDay(iso) > 2) break
    first = iso
  }
  return { days: toDay(start) - toDay(first) + 1, capped: toDay(first) - toDay(readFrom) <= 2 }
}

// The days each patient is on a chart (any ward): by ID, and — for rows typed by name — by ward and name.
// presence: the course rows' presence ([{ date, floor, ward, name, patientId }]) → seenDates({ floor, ward, name, patientId }).
export const seenDatesIndex = (presence) => {
  const byId = new Map()
  const byWardName = new Map()
  const add = (map, key, value) => { if (!map.has(key)) map.set(key, []); map.get(key).push(value) }
  presence.forEach((row) => {
    if (row.patientId) add(byId, row.patientId, row.date)
    add(byWardName, `${row.floor ?? ''}|${row.ward}|${nameKey(row.name)}`, { date: row.date, patientId: row.patientId })
  })
  return (course) => [
    ...(course.patientId ? byId.get(course.patientId) || [] : []),
    ...(byWardName.get(`${course.floor ?? ''}|${course.ward}|${nameKey(course.name)}`) || []).filter((row) => !row.patientId || row.patientId === course.patientId).map((row) => row.date),
  ]
}

const DIAGNOSIS = DRUG_REQUESTS.meropenem.groups.find((group) => group.id === 'diagnosis')
export const diagnosisTexts = (ticks, note) => DIAGNOSIS.options
  .filter((option) => (ticks || []).includes(option.key))
  .map((option) => (option.key === 'others' ? (note ? `Others: ${note}` : 'Others') : option.text))

// The form for a course: the patient's, saved on the start day or within FORM_GRACE_DAYS after it but
// before the patient's next course began (`until`, exclusive) — the earliest such one.
export const formFor = (forms, course, start, until = null) => forms
  .filter((form) => form.requestDate >= start && form.requestDate <= toIso(toDay(start) + FORM_GRACE_DAYS) && (!until || form.requestDate < until)
    && samePatient({ ...form, ...wardOfKey(form.wardKey) }, course))
  .sort((a, b) => a.requestDate.localeCompare(b.requestDate))[0] || null
const wardOfKey = (wardKey) => { const [floor, ...ward] = String(wardKey).split('|'); return { floor: floor === '' ? null : Number(floor), ward: ward.join('|') } }

// One report row. `course` = { floor, ward, name, patientId, startDate, totalMg, stayDays, stayCapped }.
export const reportRow = (course, form) => {
  const dose = inferDose(course.totalMg)
  return {
    floor: course.floor, ward: course.ward, name: course.name, patientId: course.patientId, startDate: course.startDate,
    sex: form?.fields?.sex || '', age: form?.fields?.age || '',
    diagnoses: form ? diagnosisTexts(form.ticks, form.note) : [],
    doseMg: dose?.doseMg ?? null, perDay: dose?.perDay ?? null,
    stayDays: course.stayDays, stayCapped: course.stayCapped,
    hasForm: Boolean(form),
  }
}

export const sortRows = (rows) => rows.sort((a, b) => a.startDate.localeCompare(b.startDate)
  || String(a.floor ?? 99).localeCompare(String(b.floor ?? 99), undefined, { numeric: true })
  || a.ward.localeCompare(b.ward, 'ar') || a.name.localeCompare(b.name, 'ar'))

// A patient has one D1 per course, so the same start can only come twice from one hospital-wide key
// (a first day dosed on two wards at once): keep the first. Also the day before the patient's next
// start, which closes the grace period of a form.
export const dedupeStarts = (courses) => {
  const seen = new Set()
  return courses.filter((course) => { const id = `${course.key}|${course.startDate}`; if (seen.has(id)) return false; seen.add(id); return true })
}
export const nextStartOf = (courses, course) => courses
  .filter((other) => other.key === course.key && other.startDate > course.startDate).map((other) => other.startDate).sort()[0] || null
