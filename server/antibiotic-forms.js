// «استمارة صرف المضادات الحياتية»: who on a ward needs one, and what the saved charts and the request forms already
// say for it. Pure, so the rules can be tested without a database (see antibiotic-forms.test.js); the route reads.
// Only what the records hold is filled in: the frequency is never guessed (a vial count is not a dose schedule), and
// the allergy and culture answers of an earlier request form are offered as hints, never pre-selected.
import { buildMeropenemForm, windowStart, wardKeyOf } from './meropenem.js'
import { antibioticOf, ORAL, PARENTERAL, PER_VOLUME } from './ddd.js'
import { strengthMg, colistinIU } from '../shared/dose.js'
import { nameKey, samePatient, stayRun, diagnosisTexts, seenDatesIndex } from './ward-positions.js'
import { DRUG_REQUESTS, CARRY_DAYS, toEnglish } from '../shared/drug-requests.js'
import { googleDrugName, isFinal, YES, NO, FORMS_FROM } from '../shared/antibiotic-form.js'

// A patient is listed while their last dose of an antibiotic on this ward is this recent: the form is
// often finished after the course, or after the patient has gone.
export const RECENT_DOSE_DAYS = 14
// How far back a saved form is looked for (the route reads this many days of the ward's forms).
export const FORM_DAYS = 30

const DAY_MS = 86400000
const toDay = (iso) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS)
const plusDays = (iso, days) => new Date((toDay(iso) + days) * DAY_MS).toISOString().slice(0, 10)
const isThursday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay() === 4

// A unit's strength as the Google Form writes it; 0 when the name gives none per unit (a syrup's is per ml).
const amountOf = (medicine, colistin) => (PER_VOLUME.test(medicine) ? 0 : colistin ? colistinIU(medicine) : strengthMg(medicine))
// Every strength given on the day, largest first («1000 mg + 500 mg»); blank if any one cannot be read.
const strengthOf = (medicines, colistin) => {
  const amounts = medicines.map((medicine) => amountOf(medicine, colistin))
  if (!amounts.length || amounts.some((amount) => !amount)) return ''
  return [...new Set(amounts)].sort((a, b) => b - a).map((amount) => `${amount} ${colistin ? 'IU' : 'mg'}`).join(' + ')
}
// From the medicine names (vial / tab …); both left unanswered when no name says.
const routeOf = (medicines) => {
  const injection = medicines.some((medicine) => PARENTERAL.test(medicine))
  const oral = medicines.some((medicine) => ORAL.test(medicine))
  return injection || oral ? { oral: oral ? YES : NO, injection: injection ? YES : NO } : { oral: '', injection: '' }
}

// An earlier request form's answers, as hints: { answer, detail }.
const ALLERGY_NONE = /^(لا|كلا|لا يوجد|لايوجد|no|none|nil|nkda|-)$/i
const allergyHint = (request) => {
  const said = String(request.fields?.allergy || '').trim()
  return said ? { answer: ALLERGY_NONE.test(said) ? NO : YES, detail: said } : null
}
const CULTURE_GROUP = DRUG_REQUESTS.meropenem.groups.find((group) => group.id === 'culture').options
const CULTURE_SENT = { 'culture-before': YES, 'culture-after': YES, 'culture-none': NO }
const cultureHint = (request) => {
  const tick = (Array.isArray(request.ticks) ? request.ticks : []).find((key) => CULTURE_SENT[key])
  if (tick) return { answer: CULTURE_SENT[tick], detail: CULTURE_GROUP.find((option) => option.key === tick).text }
  const result = request.fields?.culture
  if (result === 'Resistant' || result === 'Sensitive') return { answer: YES, detail: result }
  return result === 'Not done' ? { answer: NO, detail: result } : null
}
const diagnosisOf = (request) => (request.kind === 'meropenem' ? diagnosisTexts(request.ticks, request.note).join('; ') : String(request.fields?.diagnosis || '').trim())
const ageOf = (request) => (/\d+(?:\.\d+)?/.exec(toEnglish(request.fields?.age)) || [''])[0]

// rows: loadCourseRows for the ward and `date` with every followed antibiotic's names. overridesByDrug: drug key ->
// typed course days. requests: drug_requests rows ({ id, kind, wardKey, date, name, patientId, fields, ticks, note })
// of the last CARRY_DAYS, on this ward or carrying one of its patients' IDs. forms: this ward's saved antibiotic forms
// ({ id, name, patientId, formDate, fields, updatedAt, … }) of the last FORM_DAYS.
export const buildCandidates = ({ rows, date, overridesByDrug = new Map(), requests = [], forms = [], formsFrom = FORMS_FROM }) => {
  const { floor, ward } = rows
  const here = wardKeyOf(floor, ward)
  const since = plusDays(date, -RECENT_DOSE_DAYS)
  // Who is listed: a last dose in the last two weeks, and not before the form began (FORMS_FROM). The course itself is still read
  // from `since` (and its look-back), so a course that began before then keeps its real start date and day count.
  const listFrom = since > formsFrom ? since : formsFrom
  const readFrom = windowStart(date)
  const hereCharted = new Set(rows.charted.filter((row) => row.floor === floor && row.ward === ward).map((row) => row.date))
  // The ward's latest chart on or before the asked day (a Friday has none: Thursday's counts). A patient on it is still in the ward.
  const latestChart = [...hereCharted].filter((iso) => iso <= date).sort().pop() || ''

  // Antibacterials only (antifungals are followed too, but this form is the antibiotics').
  const byDrug = new Map()
  rows.cells.forEach((cell) => {
    const drug = antibioticOf(cell.medicine)
    if (!drug?.antibacterial) return
    if (!byDrug.has(drug.key)) byDrug.set(drug.key, { ...drug, cells: [] })
    byDrug.get(drug.key).cells.push(cell)
  })

  const patients = new Map()
  byDrug.forEach((drug) => {
    const overrides = overridesByDrug.get(drug.key) || []
    // The follow-up's own course rules (D-numbers, forgiven gaps, Fridays, transfers, typed days), from `since`.
    buildMeropenemForm({ ...rows, cells: drug.cells, perDay: drug.perDay, overrides, since }).patients.forEach((row) => {
      // This patient's doses on this ward, both charts: the dates, days, strength and route come from all of them (a patient moved to
      // الجارت الإضافي mid-course keeps the course's real length and stop). Who is LISTED is the main chart's: a dose on it since listFrom.
      const mine = drug.cells.filter((cell) => cell.floor === floor && cell.ward === ward && (row.patientId
        ? cell.patientId === row.patientId || (!cell.patientId && nameKey(cell.name) === row.name)
        : !cell.patientId && nameKey(cell.name) === row.name))
      const lastOf = (cells) => cells.reduce((latest, cell) => (cell.date > latest ? cell.date : latest), '')
      const lastMain = lastOf(mine.filter((cell) => !cell.extra))
      if (!lastMain || lastMain < listFrom) return
      const lastDose = lastOf(mine)
      const n = row.days[lastDose]
      if (!n) return
      // The latest course only: its day count on the last dose day, counted back to its first day.
      const rawStart = plusDays(lastDose, 1 - n)
      const active = row.status.kind === 'active'
      // A typed course day (D4 on arrival, say) moves the count, not the dates the ward gave it: no start date then.
      const typed = overrides.some((override) => override.patientKey === row.key && override.date >= rawStart && override.date <= lastDose)
      // A course reaching the start of what was read began earlier than this can tell.
      const capped = toDay(rawStart) - toDay(readFrom) <= 2
      // No chart on Friday: Thursday's carries its doses, so a course last charted on a Thursday ran through the Friday.
      const bridged = !active && isThursday(lastDose) && !hereCharted.has(plusDays(lastDose, 1))
      const lastDay = [...new Set(mine.filter((cell) => cell.date === lastDose).map((cell) => cell.medicine))]
      const course = [...new Set(mine.filter((cell) => cell.date >= rawStart).map((cell) => cell.medicine))]
      if (!patients.has(row.key)) patients.set(row.key, { key: row.key, name: row.name, patientId: row.patientId, drugs: [] })
      const patient = patients.get(row.key)
      if (!patient.patientId) patient.patientId = row.patientId
      patient.drugs.push({
        drugKey: drug.key, label: drug.label, drug: googleDrugName(drug.label), medicine: lastDay.join(' + '),
        strength: strengthOf(lastDay, drug.key === 'colistimethate'), ...routeOf(course), frequency: '',
        days: capped ? '' : String(n + (bridged ? 1 : 0)),
        start: typed || capped ? '' : rawStart,
        stop: active ? '' : bridged ? plusDays(lastDose, 1) : lastDose,
        // Shown, not stored: the units charted on the last dose day (a hint for the frequency), the course day, the status.
        unitsPerDay: mine.filter((cell) => cell.date === lastDose).reduce((sum, cell) => sum + Number(cell.quantity || 0), 0),
        day: n, status: row.status,
      })
    })
  })

  const seenDates = seenDatesIndex(rows.presence)
  const fromDay = plusDays(date, -CARRY_DAYS)
  const used = new Set()
  const latestFirst = (a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))
  const list = [...patients.values()].map((patient) => {
    const who = { floor, ward, name: patient.name, patientId: patient.patientId }
    // The stay: the run of days on a chart up to the last one seen (one missing day forgiven, as «مواقف القسم» counts it).
    const seen = seenDates(who).filter((iso) => iso <= date)
    const lastSeen = seen.reduce((latest, iso) => (iso > latest ? iso : latest), '') || date
    const stay = stayRun(seen, lastSeen, readFrom)
    const admitted = plusDays(lastSeen, 1 - stay.days)
    patient.drugs.forEach((drug) => { if (drug.start && !stay.capped && drug.start < admitted) drug.start = '' })
    patient.drugs.sort((a, b) => a.label.localeCompare(b.label))

    // The request forms (Meropenem, Tigecycline, …) of the last CARRY_DAYS, matched as the request popup matches them:
    // by ID, else by name on this ward when one side has no ID. Newest first.
    const theirs = requests
      .filter((request) => request.date >= fromDay && request.date <= date && ((patient.patientId && request.patientId === patient.patientId)
        || (request.wardKey === here && nameKey(request.name) === patient.name && (!patient.patientId || !request.patientId))))
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
    const pick = (read) => {
      for (const request of theirs) {
        const value = read(request)
        if (value) return { value, source: DRUG_REQUESTS[request.kind]?.label || request.kind, date: request.date }
      }
      return null
    }
    const hint = (read) => { const found = pick(read); return found && { ...found.value, source: found.source, date: found.date } }

    // This stay's saved form: the patient's newest one begun since admission, or one still open.
    const form = forms.filter((saved) => !used.has(saved.id) && samePatient({ ...saved, floor, ward }, who) && (saved.formDate >= admitted || !isFinal(saved.fields)))
      .sort(latestFirst)[0] || null
    if (form) used.add(form.id)
    return {
      key: patient.key, name: patient.name, patientId: patient.patientId, admitted,
      // false = no longer on the ward's chart (discharged, died, moved to another ward): the screen lists them apart.
      inChart: !!latestChart && rows.presence.some((row) => row.date === latestChart && row.floor === floor && row.ward === ward
        && (patient.patientId ? row.patientId === patient.patientId || (!row.patientId && nameKey(row.name) === patient.name) : !row.patientId && nameKey(row.name) === patient.name)),
      prefill: { age: pick(ageOf), diagnosis: pick(diagnosisOf), stayDays: { value: stay.capped ? `${stay.days}+` : String(stay.days), source: 'الجارت' } },
      hints: { allergy: hint(allergyHint), culture: hint(cultureHint) },
      drugs: patient.drugs,
      form,
    }
  }).sort((a, b) => a.name.localeCompare(b.name, 'ar'))

  // Forms of patients not on this list (typed in by hand, or off antibiotics for a while): the open ones and the recent ones.
  const manual = forms.filter((saved) => !used.has(saved.id) && (!isFinal(saved.fields) || saved.formDate >= since)).sort(latestFirst)
  const lastDepartment = forms.filter((saved) => saved.fields?.department).sort(latestFirst)[0]?.fields.department || ''
  return { patients: list, manual, lastDepartment }
}
