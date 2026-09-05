// Pure helpers with no React and no I/O, so they can be read — and reasoned about — without
// the component around them.
import { floors, specialWards, PATIENT_ROWS, CHART_COLUMNS } from './constants.js'

// Shared by the two places a chart snapshot from elsewhere (the server, after a save
// conflict; or localStorage, after a killed tab) has to be combined with what is on screen:
// field by field, a value that differs from `base` (the last state this tab knows the
// server actually has) is an edit made here and wins; everything else adopts `fresh`.
export const mergeChartSnapshots = (base, current, fresh) => ({
  patientNames: fresh.patientNames.map((value, index) => (current.patientNames[index] !== base.patientNames[index] ? current.patientNames[index] : value)),
  columnMedicines: fresh.columnMedicines.map((value, index) => (current.columnMedicines[index] !== base.columnMedicines[index] ? current.columnMedicines[index] : value)),
  quantities: fresh.quantities.map((row, rowIndex) => row.map((value, columnIndex) => (current.quantities[rowIndex][columnIndex] !== base.quantities[rowIndex]?.[columnIndex] ? current.quantities[rowIndex][columnIndex] : value))),
})

// GET /api/chart's row-per-cell shape, expanded to the fixed-size grid the UI keeps in state.
export const parseChartRows = (chart) => {
  const patientNames = Array(PATIENT_ROWS).fill('')
  const quantities = Array.from({ length: PATIENT_ROWS }, () => Array(CHART_COLUMNS).fill(''))
  const columnMedicines = Array(CHART_COLUMNS).fill('')
  if (chart) {
    chart.patients.forEach((patient) => { patientNames[patient.row_number - 1] = patient.patient_name })
    chart.quantities.forEach((quantity) => { quantities[quantity.row_number - 1][quantity.column_number - 1] = String(quantity.quantity) })
    chart.columns.forEach((column) => { columnMedicines[column.column_number - 1] = column.medicine_name || '' })
  }
  return { patientNames, columnMedicines, quantities }
}

export const toEnglishDigits = (value) => value.replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
// Three supplies carry a quantity the pharmacist should not have to type. They are matched by
// pattern rather than by exact name: none of them is in the catalogue yet, so whatever spelling
// gets added later — Arabic or Latin, any case, any spacing, Arabic-Indic or Latin digits —
// still has to be recognised. toEnglishDigits runs first so "سرنجة ٥ سيسي" and "syringe 5cc"
// normalise the same way.
export const medicineKey = (value) => toEnglishDigits(String(value ?? '')).trim().replace(/\s+/g, ' ').toLowerCase()
// One per patient on the ward: a giving set and a cannula each get used once.
export const UNIT_ONE = /\biv\s*-?\s*set\b|كانيول|cannula|canula/
// The 5cc syringe. The digit is required: without it "Clexane prefilled syringe 4000 IU",
// which is already in the catalogue, would be mistaken for it.
const SYRINGE_NAME = /سرنج|syringe/
// A 5 that is not part of a longer number, so "5cc" and "٥ سيسي" match while "4000" and
// "500" do not. Written without lookbehind, which older iPadOS Safari does not support.
const SYRINGE_SIZE = /(^|\D)5(\D|$)/
export const isSyringe = (name) => { const key = medicineKey(name); return SYRINGE_NAME.test(key) && SYRINGE_SIZE.test(key) }
// What a syringe is drawn from. Word boundaries, like PILL_FORM on the server, so that
// "Ampicillin" is not read as an ampoule.
export const VIAL_AMP = /\b(vial|vials|amp|amps|ampoule|ampoules)\b/

export const isoDate = (value) => {
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export const locationBody = (value) => {
  const asFloor = Number(value)
  if (floors.some((item) => item.number === asFloor)) return { floor: asFloor }
  if (specialWards.includes(value)) return { ward: value }
  return null
}

// Pill entries are held as { "<row>:<medicine key>": {...} }. The medicine key is a name, so
// split on the first colon only rather than on every one.
export const pillEntryList = (entries) => Object.entries(entries).map(([key, value]) => {
  const separator = key.indexOf(':')
  return {
    patientRowNumber: Number(key.slice(0, separator)),
    medicineKey: key.slice(separator + 1),
    doseTime: value.doseTime || '', usageMethod: value.usageMethod || '', note: value.note || '',
  }
})
