// «استمارة صرف المضادات الحياتية»: the unit's Google Form (27 required questions), filled in the app from the saved
// charts and exported to Excel one row per antibiotic. One form per patient per ward stay (server/routes/antibiotic-forms.js);
// read by the server (what it stores) and the app (the sheet, the list, the export). Labels are the Google Form's own,
// spelling and spacing kept, so the sheet lines up with the one the unit already keeps.
import { toEnglish } from './drug-requests.js'
import { stripInvisible } from './clean-name.js'

export const YES = 'نعم'
export const NO = 'لا'
export const YES_NO = [YES, NO]
// «الردهة» on the Google Form is the department, not the app's ward.
export const DEPARTMENTS = ['الباطنية', 'الجراحة', 'النسائية']
// What was done after the 48-72 h review: each its own yes/no question on the Google Form.
export const CHANGES = [
  { key: 'same', label: 'الاستمرار على نفس الجرعة' },
  { key: 'increase', label: 'زيادة الجرعة' },
  { key: 'decrease', label: 'تقليل  الجرعة' }, // (the Google title has the double space)
  { key: 'change', label: 'تغيير المضاد' },
  { key: 'add', label: 'اضافة مضاد' },
  { key: 'stop', label: 'توقف مضاد' },
]
export const OUTCOMES = [
  { key: 'recovery', label: 'شفاء' },
  { key: 'deterioration', label: 'تدهور' },
  { key: 'death', label: 'موت' },
  { key: 'dischargeOn', label: 'خروج مع استمرار المضاد' },
  { key: 'dischargeOff', label: 'خروج و توقف المضاد' },
]
// The outcome group's «none yet» answer: every outcome is لا and the form stays open.
export const STILL_ADMITTED = 'stillAdmitted'
export const FREQUENCIES = ['1', '2', '3', '4']
// The Google Form's drug list (its spelling) and the follow-up's name for each (server/ddd.js antibioticOf).
export const QUICK_DRUGS = [
  { name: 'amikacin', label: 'Amikacin' },
  { name: 'amoxicillin', label: 'Amoxicillin' },
  { name: 'augementin', label: 'Amoxicillin/clavulanate' },
  { name: 'ceftrixone', label: 'Ceftriaxone' },
  { name: 'ceftazidime', label: 'Ceftazidime' },
  { name: 'cefotaxime', label: 'Cefotaxime' },
  { name: 'ciprofloxacin', label: 'Ciprofloxacin' },
  { name: 'colistin', label: 'Colistin' },
  { name: 'flagyl', label: 'Metronidazole' },
  { name: 'gentamicin', label: 'Gentamicin' },
  { name: 'levofloxacin', label: 'Levofloxacin' },
  { name: 'meropenem', label: 'Meropenem' },
  { name: 'septrin', label: 'Co-trimoxazole' },
  { name: 'tazocin', label: 'Piperacillin/tazobactam' },
  { name: 'vancomycin', label: 'Vancomycin' },
]
export const QUICK_STRENGTHS = ['1000 mg', '500 mg', '625 mg', '480 mg', '250 mg', '80 mg']
export const MAX_DRUGS = 10
// The form is used from this day (Sunday 15/11/2026): a patient is listed only for antibiotics charted on or after it.
export const FORMS_FROM = '2026-11-15'
// A follow-up drug as the Google Form spells it; one it does not list keeps its own name.
export const googleDrugName = (label) => (QUICK_DRUGS.find((item) => item.label.toLowerCase() === String(label).toLowerCase()) || {}).name || label

const FIELD_KEYS = ['age', 'department', 'diagnosis', 'stayDays', 'allergy', 'culture', 'review48', ...CHANGES.map((item) => item.key), ...OUTCOMES.map((item) => item.key), STILL_ADMITTED]
const YES_NO_KEYS = ['allergy', 'culture', 'review48', ...CHANGES.map((item) => item.key), ...OUTCOMES.map((item) => item.key), STILL_ADMITTED]

const text = (value, max) => stripInvisible(toEnglish(value)).replace(/\s+/g, ' ').trim().slice(0, max)
const choice = (value, list) => { const given = String(value ?? '').trim(); return list.includes(given) ? given : '' }
const digits = (value, max) => toEnglish(value).replace(/\D/g, '').slice(0, max)
const isoDay = (value) => {
  const day = String(value ?? '')
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(`${day}T00:00:00Z`)) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day ? day : ''
}
// A group of yes/no questions answered by chips: once any is answered, the rest are «لا».
const settle = (fields, keys) => { if (keys.some((key) => fields[key])) keys.forEach((key) => { if (!fields[key]) fields[key] = NO }) }

const cleanDrug = (drug) => {
  const given = drug && typeof drug === 'object' ? drug : {}
  const clean = {
    drug: text(given.drug, 60), medicine: text(given.medicine, 200), strength: text(given.strength, 40),
    oral: choice(given.oral, YES_NO), injection: choice(given.injection, YES_NO),
    frequency: digits(given.frequency, 2), days: digits(given.days, 3), start: isoDay(given.start), stop: isoDay(given.stop),
  }
  settle(clean, ['oral', 'injection'])
  return clean
}

// What a save sends, cleaned the same way on both sides: known keys only, choices checked, digits made English.
export const cleanForm = (form) => {
  const given = form && typeof form === 'object' ? form : {}
  const sent = given.fields && typeof given.fields === 'object' ? given.fields : {}
  const fields = {}
  FIELD_KEYS.forEach((key) => { fields[key] = YES_NO_KEYS.includes(key) ? choice(sent[key], YES_NO) : '' })
  fields.age = toEnglish(sent.age).replace(/[٫,]/g, '.').replace(/[^\d.]/g, '').slice(0, 6)
  fields.department = choice(sent.department, DEPARTMENTS)
  fields.diagnosis = text(sent.diagnosis, 300)
  const stay = /^(\d{1,3})(\+?)$/.exec(toEnglish(sent.stayDays).trim())
  fields.stayDays = stay ? `${Number(stay[1])}${stay[2]}` : ''
  settle(fields, CHANGES.map((item) => item.key))
  // The outcome: one of the five, or «لا يزال في الردهة» (none of them yet).
  if (OUTCOMES.some((item) => fields[item.key] === YES)) fields[STILL_ADMITTED] = NO
  else if (fields[STILL_ADMITTED] === YES) OUTCOMES.forEach((item) => { fields[item.key] = NO })
  settle(fields, [...OUTCOMES.map((item) => item.key), STILL_ADMITTED])
  const drugs = (Array.isArray(given.drugs) ? given.drugs : []).slice(0, MAX_DRUGS).map(cleanDrug)
    .filter((drug) => Object.values(drug).some(Boolean))
  return {
    name: stripInvisible(given.name).replace(/\s+/g, ' ').trim().slice(0, 200),
    patientId: digits(given.patientId, 20),
    fields,
    drugs,
  }
}

// The outcome is final once one of the five is «نعم»; until then the form stays open (editable on later days).
export const isFinal = (fields) => OUTCOMES.some((item) => fields?.[item.key] === YES)

// The Google Form's questions still unanswered, in its order: [{ key, label }]. `key` names the box
// (drug boxes as `drug:<index>:<field>`), so the sheet can jump to it.
export const missingAnswers = (form) => {
  const fields = form.fields || {}
  const drugs = form.drugs || []
  const missing = []
  const need = (ok, key, label) => { if (!ok) missing.push({ key, label }) }
  need(form.name, 'name', 'اسم المريض')
  need(fields.age, 'age', 'العمر')
  need(fields.department, 'department', 'الردهة')
  need(fields.diagnosis, 'diagnosis', 'التشخيص')
  need(fields.stayDays, 'stayDays', 'فترة الرقود')
  need(fields.allergy, 'allergy', 'الحساسية')
  need(drugs.length, 'drugs', 'اسم المضادات')
  drugs.forEach((drug, index) => {
    const which = drug.drug || `المضاد ${index + 1}`
    need(drug.drug, `drug:${index}:drug`, `اسم المضاد ${index + 1}`)
    need(drug.oral === YES || drug.injection === YES, `drug:${index}:route`, `فموي / حقن — ${which}`)
    need(drug.strength, `drug:${index}:strength`, `الجرعة — ${which}`)
    need(drug.frequency, `drug:${index}:frequency`, `التكرار — ${which}`)
    need(drug.days, `drug:${index}:days`, `فترة البقاء على المضاد — ${which}`)
  })
  need(fields.culture, 'culture', 'وجود زرع')
  need(fields.review48, 'review48', 'مراجعة وصف المضاد بعد 48-72 ساعة')
  need(CHANGES.some((item) => fields[item.key]), 'changes', 'ما الذي تم بعد المراجعة')
  need(OUTCOMES.some((item) => fields[item.key]) || fields[STILL_ADMITTED] === YES, 'outcome', 'النتيجة')
  return missing
}

// «الطابق» as the Google Form lists it: the floor in Arabic-Indic digits, «عناية» for the ICU.
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩'
export const floorLabel = (floor, ward) => (floor ? String(floor).replace(/\d/g, (digit) => ARABIC_DIGITS[Number(digit)]) : ward === 'ردهة العناية المركزة' ? 'عناية' : ward)

// The Excel sheet: the Google Form's questions in its order («تاريخ الاستمارة» standing in for the Timestamp), then the app's extras.
export const EXPORT_COLUMNS = [
  { key: 'formDate', header: 'تاريخ الاستمارة', width: 13 },
  { key: 'name', header: 'اسم المريض', width: 24 },
  { key: 'age', header: 'العمر', width: 8 },
  { key: 'department', header: 'الردهة', width: 11 },
  { key: 'diagnosis', header: 'التشخيص (باللغة الانكليزية)', width: 32 },
  { key: 'stayDays', header: 'فترة الرقود', width: 10 },
  { key: 'allergy', header: 'الحساسية', width: 9 },
  { key: 'count', header: 'عددالمضادات الموصوفة (رقم)', width: 12 },
  { key: 'drug', header: 'اسم المضادات', width: 16 },
  { key: 'oral', header: 'فموي', width: 7 },
  { key: 'injection', header: 'حقن', width: 7 },
  { key: 'strength', header: 'الجرعة', width: 12 },
  { key: 'frequency', header: 'التكرار', width: 8 },
  { key: 'days', header: 'فترة البقاء على المضاد (رقم)', width: 12 },
  { key: 'culture', header: 'وجود زرع', width: 9 },
  { key: 'review48', header: 'مراجعة وصف المضاد بعد 48-72 ساعة', width: 14 },
  ...CHANGES.map((item) => ({ key: item.key, header: item.label, width: 11 })),
  ...OUTCOMES.map((item) => ({ key: item.key, header: item.label, width: 11 })),
  { key: 'floor', header: 'الطابق', width: 8 },
  { key: 'patientId', header: 'رقم الطبلة', width: 12 },
  { key: 'startDate', header: 'تاريخ بدء المضاد', width: 13 },
  { key: 'stopDate', header: 'تاريخ إيقاف المضاد', width: 13 },
  { key: 'ward', header: 'ردهة التطبيق', width: 24 },
]
const numeric = (value) => (/^\d+(\.\d+)?$/.test(String(value ?? '')) ? Number(value) : value || '')
// forms: [{ formDate, floor, ward, name, patientId, fields, drugs }] → one row per antibiotic, the patient's columns
// repeated on each (a form with none still gets its row).
export const exportRows = (forms) => forms.flatMap((form) => {
  const fields = form.fields || {}
  const drugs = form.drugs || []
  const patient = {
    formDate: form.formDate, name: form.name, age: numeric(fields.age), department: fields.department, diagnosis: fields.diagnosis,
    stayDays: numeric(fields.stayDays), allergy: fields.allergy, count: drugs.length, culture: fields.culture, review48: fields.review48,
    ...Object.fromEntries([...CHANGES, ...OUTCOMES].map((item) => [item.key, fields[item.key] || ''])),
    floor: floorLabel(form.floor, form.ward), patientId: form.patientId, ward: form.floor ? `الطابق ${form.floor} — ${form.ward}` : form.ward,
  }
  return (drugs.length ? drugs : [{}]).map((drug) => ({
    ...patient, drug: drug.drug || '', oral: drug.oral || '', injection: drug.injection || '', strength: drug.strength || '',
    frequency: numeric(drug.frequency), days: numeric(drug.days), startDate: drug.start || '', stopDate: drug.stop || '',
  }))
})
