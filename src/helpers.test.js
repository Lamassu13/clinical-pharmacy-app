import { test } from 'node:test'
import assert from 'node:assert/strict'
import { averagePatients, pillChanges, interactionsForChart, mergeKeyedSnapshots, diffKeyedMergeOutcome, enqueueExtraPillsOp, applyExtraPillsQueue, EXTRA_PILL_SLOTS, isDraftStale, rememberChart, recallChart, forgetChartCopies, mergePreviousDayDoses, addPatientToChart, medicineMatches, pillSheetPlan, yesterdaySchedules, scheduleFor, applyTemplateColumns, catalogueMatches, RENAL_EQUATIONS, renalGuidance, SCR_UMOL_PER_MGDL } from './helpers.js'

test('mergeKeyedSnapshots keeps a local edit and adopts an unrelated server change', () => {
  const base = { a: '1', b: '2' }
  const current = { a: '1-edited', b: '2' } // only "a" was actually touched here
  const fresh = { a: '1-from-server', b: '2-from-server' } // another device changed both
  const merged = mergeKeyedSnapshots(base, current, fresh)
  assert.equal(merged.a, '1-edited') // mine wins: differs from base
  assert.equal(merged.b, '2-from-server') // fresh wins: base already matched mine
})

test('mergeKeyedSnapshots adopts a brand-new server key untouched locally', () => {
  const merged = mergeKeyedSnapshots({}, {}, { c: 'new' })
  assert.equal(merged.c, 'new')
})

test('diffKeyedMergeOutcome counts adopted vs silently-dropped fields', () => {
  const base = { a: '1', b: '2' }
  const mine = { a: '1-edited', b: '2' }
  const fresh = { a: '1-from-server', b: '2-from-server' }
  const merged = mergeKeyedSnapshots(base, mine, fresh)
  const { adopted, dropped } = diffKeyedMergeOutcome(merged, mine, fresh)
  assert.equal(adopted, 1) // b came from fresh
  assert.equal(dropped, 1) // a: mine won over a genuinely different fresh value
})

test('enqueueExtraPillsOp replaces a prior pending op for the same key', () => {
  const queue = [{ key: '5', op: 'update', id: 5, patch: { patientName: 'old' } }]
  const next = enqueueExtraPillsOp(queue, { key: '5', op: 'update', id: 5, patch: { patientName: 'new' } })
  assert.equal(next.length, 1)
  assert.equal(next[0].patch.patientName, 'new')
})

test('enqueueExtraPillsOp cancels a queued create outright on delete', () => {
  const queue = [{ key: 'temp-1', op: 'create', patch: null }]
  const next = enqueueExtraPillsOp(queue, { key: 'temp-1', op: 'delete', id: null })
  assert.deepEqual(next, [])
})

test('applyExtraPillsQueue falls back to a full blank form for a create queued before it was ever filled in', () => {
  // Regression: a form created offline and never saved before a reload used to project as
  // { id, pending: true } with no `entries` at all, which crashed ExtraPillFormCard's
  // entries.map() the moment the ward was reopened.
  const result = applyExtraPillsQueue([], [{ key: 'temp-1', op: 'create', floor: 3, ward: 'ردهة CCU', patch: null }])
  assert.equal(result.length, 1)
  assert.equal(result[0].entries.length, EXTRA_PILL_SLOTS)
  assert.equal(result[0].patientName, '')
})

test('applyExtraPillsQueue layers a pending create, update and delete onto server forms', () => {
  const forms = [{ id: 1, patientName: 'Ali' }, { id: 2, patientName: 'Sara' }]
  const queue = [
    { key: 'temp-1', op: 'create', patch: { patientName: 'New patient' } },
    { key: '1', op: 'update', id: 1, patch: { patientName: 'Ali edited' } },
    { key: '2', op: 'delete', id: 2 },
  ]
  const result = applyExtraPillsQueue(forms, queue)
  assert.deepEqual(result.map((f) => f.id), [1, 'temp-1'])
  assert.equal(result[0].patientName, 'Ali edited')
  assert.equal(result[0].pending, true)
  assert.equal(result[1].patientName, 'New patient')
})

test('isDraftStale keeps a draft for a week, so unsaved work on a past date is not dropped', () => {
  assert.equal(isDraftStale({ date: '2026-09-22' }, '2026-09-22'), false)
  assert.equal(isDraftStale({ date: '2026-09-21' }, '2026-09-22'), false)
  assert.equal(isDraftStale({ date: '2026-09-15' }, '2026-09-22'), false)
  assert.equal(isDraftStale({ date: '2026-09-14' }, '2026-09-22'), true)
  assert.equal(isDraftStale({}, '2026-09-22'), true)
})

test('mergeChartSnapshots/diffMergeOutcome: patient IDs merge per row, and a pre-ID draft (no patientIds) still merges', async () => {
  const { mergeChartSnapshots, diffMergeOutcome } = await import('./helpers.js')
  const grid = (names, ids) => ({ patientNames: names, ...(ids && { patientIds: ids }), columnMedicines: [''], quantities: names.map(() => ['']) })
  const base = grid(['a', 'b'], ['', ''])
  const mine = grid(['a', 'b'], ['11', ''])
  const fresh = grid(['a', 'b'], ['', '22'])
  const merged = mergeChartSnapshots(base, mine, fresh)
  assert.deepEqual(merged.patientIds, ['11', '22'])
  assert.deepEqual(diffMergeOutcome(merged, mine, fresh).adopted, ['رقم المريض صف 2'])
  const oldDraft = mergeChartSnapshots(grid(['a', 'b']), grid(['x', 'b']), fresh)
  assert.deepEqual(oldDraft.patientIds, ['', '22'])
  assert.deepEqual(oldDraft.patientNames, ['x', 'b'])
})

test('addOfflineRows: a patient typed offline in row 1 is added beside the server\'s row 1, never over it', async () => {
  const { addOfflineRows } = await import('./helpers.js')
  const grid = (names, ids, meds, qty) => ({ patientNames: names, patientIds: ids, columnMedicines: meds, quantities: qty })
  const fresh = grid(['Server Patient', '', ''], ['111', '', ''], ['Panadol 500mg Tab', ''], [['2', ''], ['', ''], ['', '']])
  // Offline: row 1 is a different patient, with Panadol in column 2 and a new medicine in column 1.
  const offline = grid(['Offline Patient', '', ''], ['222', '', ''], ['Flagyl 500mg Tab', 'panadol  500mg tab'], [['1', '4'], ['', ''], ['', '']])
  const { merged, unplaced } = addOfflineRows(fresh, offline)
  assert.equal(unplaced, 0)
  assert.deepEqual(merged.patientNames, ['Server Patient', 'Offline Patient', ''])
  assert.deepEqual(merged.patientIds, ['111', '222', ''])
  assert.deepEqual(merged.columnMedicines, ['Panadol 500mg Tab', 'Flagyl 500mg Tab'])
  assert.deepEqual(merged.quantities, [['2', ''], ['4', '1'], ['', '']])
})

test('addOfflineRows: the same patient (by ID) typed offline lands on their existing row; a full grid reports what did not fit', async () => {
  const { addOfflineRows } = await import('./helpers.js')
  const grid = (names, ids, meds, qty) => ({ patientNames: names, patientIds: ids, columnMedicines: meds, quantities: qty })
  const fresh = grid(['A', 'B'], ['1', '2'], ['X'], [['1'], ['1']])
  const { merged, unplaced } = addOfflineRows(fresh, grid(['B', 'C'], ['2', '3'], ['X'], [['5'], ['1']]))
  assert.deepEqual(merged.quantities, [['1'], ['5']])
  assert.equal(unplaced, 1)
})

test('mergePreviousDayDoses keeps headers typed meanwhile and fills blanks with yesterday\'s medicines', () => {
  const catalogue = ['Amikacin 500mg Vial', 'Meronem 1000gm Vial', 'Paracetamol 1g bottle']
  // Typed today after the offer appeared: column 1 = Amikacin, with a dose on row 1.
  const columns = ['', 'Amikacin 500mg Vial', '', '']
  const quantities = [['', '', '', ''], ['', '2', '', '']]
  const prevDoses = [{ med: 'meronem 1000gm vial', qty: '3' }, { med: 'Amikacin 500mg Vial', qty: '1' }, { med: 'Gone From Catalogue', qty: '9' }]
  const merged = mergePreviousDayDoses(columns, quantities, 0, prevDoses, catalogue)
  assert.deepEqual(merged.columns, ['Meronem 1000gm Vial', 'Amikacin 500mg Vial', '', ''])
  assert.deepEqual(merged.quantities[0], ['3', '1', '', ''])
  assert.deepEqual(merged.quantities[1], ['', '2', '', '']) // the other row is untouched
  assert.deepEqual(columns, ['', 'Amikacin 500mg Vial', '', '']) // inputs not mutated
})

test('medicineMatches lists prefix matches before contains, capped', () => {
  const catalogue = ['Ameronem X', 'Meronem 1000gm Vial', 'Meronem 500mg Vial', 'Paracetamol']
  assert.deepEqual(medicineMatches('mer', catalogue), ['Meronem 1000gm Vial', 'Meronem 500mg Vial', 'Ameronem X'])
  assert.deepEqual(medicineMatches('  ', catalogue), [])
  assert.equal(medicineMatches('e', catalogue, 2).length, 2)
})

test('pillSheetPlan: spare rows never push the signature onto an empty sheet', () => {
  const meds = (n) => Array.from({ length: n }, (_, i) => i)
  const shape = (plan) => [plan.pages.map((page) => page.length), plan.extraCount]
  assert.deepEqual(shape(pillSheetPlan(meds(3))), [[3], 2])
  assert.deepEqual(shape(pillSheetPlan(meds(6))), [[6], 1]) // was 6 + 2 -> orphan sheet
  assert.deepEqual(shape(pillSheetPlan(meds(7))), [[7], 0])
  assert.deepEqual(shape(pillSheetPlan(meds(7), { requestedExtras: 1 })), [[7, 0], 1]) // asked for: own sheet
  assert.deepEqual(shape(pillSheetPlan(meds(6), { filledExtraReach: 2 })), [[6, 0], 2]) // filled rows are never dropped
  assert.deepEqual(shape(pillSheetPlan(meds(9))), [[7, 2], 2])
})

test('yesterdaySchedules matches a patient by ID first, then by name', () => {
  const yesterday = yesterdaySchedules({
    patients: [{ rowNumber: 3, name: 'زهراء  كاظم', patientId: '777' }, { rowNumber: 4, name: 'مريم', patientId: '' }],
    entries: [
      { patientRowNumber: 3, medicineKey: 'amaryl 2mg tab', doseTime: 'صباحًا', usageMethod: '', note: '' },
      { patientRowNumber: 3, medicineKey: 'extra-row-1', doseTime: 'x', usageMethod: '', note: '' },
      { patientRowNumber: 4, medicineKey: 'aspirin 100mg tab', doseTime: '', usageMethod: 'بعد الطعام', note: '' },
    ],
  })
  assert.deepEqual(Object.keys(scheduleFor(yesterday, { name: 'اسم آخر', patientId: '777' })), ['amaryl 2mg tab'])
  assert.equal(scheduleFor(yesterday, { name: 'مريم', patientId: '' })['aspirin 100mg tab'].usageMethod, 'بعد الطعام')
  assert.equal(scheduleFor(yesterday, { name: 'غير موجود', patientId: '' }), null)
  assert.equal(yesterdaySchedules(null), null)
})

test('applyTemplateColumns lays a template onto a dose-free chart', () => {
  const catalogue = ['Amoxil 500mg Cap', 'IV Set', 'Meronem 1000gm Vial']
  const result = applyTemplateColumns(['meronem 1000gm vial', 'Gone Since Saving', 'IV Set', 'Amoxil 500mg Cap'], catalogue, ['علي', '', 'مريم'], 51)
  assert.deepEqual(result.columns.slice(0, 4), ['Meronem 1000gm Vial', '', 'IV Set', 'Amoxil 500mg Cap'])
  assert.equal(result.columns.length, 51)
  assert.equal(result.dropped, 1)
  assert.deepEqual(result.quantities.map((row) => row.slice(0, 3)), [['', '', '1'], ['', '', ''], ['', '', '1']]) // giving set seeded for named rows only
  assert.equal(applyTemplateColumns(['IV Set'], catalogue, [], 60).columns.length, 60) // keeps a wider chart's width
})

test('catalogueMatches finds a medicine by its English or Arabic name', () => {
  const catalogue = [
    { name: 'Amoxil 500mg Cap', arabic_name: 'أموكسيل ٥٠٠ ملغ' },
    { name: 'Aspirin 100mg Tab', arabic_name: 'أسبرين' },
    { name: 'Paracetamol 1g bottle', arabic_name: 'باراسيتامول' },
    { name: 'Lasix 40mg Tab', arabic_name: '' },
    { name: 'Tramadol Tab', arabic_name: 'ترامادول الصيدلة' },
  ]
  const names = (query, limit) => catalogueMatches(query, catalogue, limit).map((entry) => entry.name)
  assert.deepEqual(names('amox'), ['Amoxil 500mg Cap'])
  assert.deepEqual(names('أموك'), ['Amoxil 500mg Cap'])
  assert.deepEqual(names('اموكسيل'), ['Amoxil 500mg Cap']) // hamza folded
  assert.deepEqual(names('ا'), ['Amoxil 500mg Cap', 'Aspirin 100mg Tab', 'Paracetamol 1g bottle', 'Tramadol Tab']) // prefix before contains
  assert.deepEqual(names('صيدله'), ['Tramadol Tab']) // ta marbuta folded
  assert.deepEqual(names('tab', 2), ['Aspirin 100mg Tab', 'Lasix 40mg Tab'])
  assert.deepEqual(names('  '), [])
})

const blankChart = (cols = 6) => ({
  patientNames: Array(41).fill(''), patientIds: Array(41).fill(''),
  columnMedicines: Array(cols).fill(''), quantities: Array.from({ length: 41 }, () => Array(cols).fill('')),
})
const cat = ['Ceftriaxone vial', 'IV set', 'Syringe 5cc', 'Lasix amp']

test('addPatientToChart: first empty row, doses placed, supplies seeded, syringe totalled', () => {
  const chart = blankChart()
  chart.columnMedicines[0] = 'IV set'; chart.columnMedicines[1] = 'Syringe 5cc'
  chart.patientNames[0] = 'Ali'
  const r = addPatientToChart(chart, { name: 'Sara', id: '٧٧', doses: [{ med: 'Ceftriaxone vial', qty: '2' }, { med: 'Lasix amp', qty: '1' }] }, cat)
  assert.equal(r.row, 1)
  assert.equal(r.chart.patientNames[1], 'Sara'); assert.equal(r.chart.patientIds[1], '77')
  const q = r.chart.quantities[1]
  assert.equal(q[0], '1')                       // IV set seeded
  assert.equal(q[1], '3')                       // syringe = 2 + 1 vial/amp
  assert.equal(q[2], '2'); assert.equal(q[3], '1')
  assert.equal(chart.patientNames[1], '')       // input untouched
})

test('addPatientToChart: same ID reuses its row; full grid and unknown medicine', () => {
  const chart = blankChart()
  chart.patientNames[4] = 'Old'; chart.patientIds[4] = '9'
  const r = addPatientToChart(chart, { name: 'New', id: '9', doses: [{ med: 'Lasix amp', qty: '2' }, { med: 'Nope', qty: '5' }] }, cat)
  assert.equal(r.row, 4); assert.equal(r.chart.patientNames[4], 'New')
  assert.equal(r.chart.columnMedicines.includes('Nope'), false)
  const full = blankChart()
  full.patientNames.fill('x')
  assert.deepEqual(addPatientToChart(full, { name: 'y', id: '', doses: [] }, cat), { ok: false, reason: 'full' })
})

test('interactionsForChart flags a named patient holding two interacting medicines', () => {
  const rules = [{ a: /warfarin/, b: /aspirin/, severity: 'major', note: 'bleeding' }]
  const chart = {
    patientNames: ['علي', 'مريم', ''],
    patientIds: ['', '', ''],
    columnMedicines: ['Warfarin 5mg Tab', 'Aspirin 75mg Tab', ''],
    quantities: [['1', '1', ''], ['1', '', ''], ['1', '1', '']],
  }
  const result = interactionsForChart(chart, rules)
  assert.equal(result.length, 1) // مريم takes only one of the two; the unnamed row is skipped
  assert.equal(result[0].name, 'علي')
  assert.deepEqual(result[0].pairs, [{ a: 'Warfarin 5mg Tab', b: 'Aspirin 75mg Tab', severity: 'major', note: 'bleeding' }])
})

test('interactionsForChart adds reference-data pairs, keeps rule notes and ranks by severity', () => {
  const rules = [{ a: /amikacin/, b: /furosemide|lasix/, severity: 'major', note: 'Additive nephrotoxicity' }]
  const chart = {
    patientNames: ['علي'], patientIds: [''],
    columnMedicines: ['Amikacin 500mg Vial', 'Lasix 40mg Tab', 'Aspirin 100mg Tab', 'Zinc'],
    quantities: [['1', '1', '1', '']],
  }
  const dbPairs = [
    { a: 'Lasix 40mg Tab', b: 'Aspirin 100mg Tab', level: 'moderate' },
    { a: 'Aspirin 100mg Tab', b: 'Amikacin 500mg Vial', level: 'minor' },
    { a: 'Lasix 40mg Tab', b: 'Zinc', level: 'major' }, // Zinc has no dose: ignored
  ]
  const [patient] = interactionsForChart(chart, rules, dbPairs)
  assert.deepEqual(patient.pairs.map((pair) => [pair.a, pair.b, pair.severity, pair.note]), [
    ['Amikacin 500mg Vial', 'Lasix 40mg Tab', 'major', 'Additive nephrotoxicity'],
    ['Lasix 40mg Tab', 'Aspirin 100mg Tab', 'moderate', ''],
    ['Amikacin 500mg Vial', 'Aspirin 100mg Tab', 'minor', ''],
  ])
})

test('interactionsForChart lists duplicate therapy after moderate, and as the note on a pair that also interacts', () => {
  const chart = {
    patientNames: ['علي'], patientIds: [''],
    columnMedicines: ['Risek 20mg cap', 'Pantoprazole 40mg vial', 'Brufen 400mg Tab', 'Voltarin 75mg Amp', 'Amikacin 500mg Vial', 'Lasix 40mg Tab'],
    quantities: [['1', '1', '1', '1', '1', '1']],
  }
  const dbPairs = [{ a: 'Brufen 400mg Tab', b: 'Voltarin 75mg Amp', level: 'moderate' }, { a: 'Amikacin 500mg Vial', b: 'Lasix 40mg Tab', level: 'major' }]
  const duplicates = [
    { a: 'Risek 20mg cap', b: 'Pantoprazole 40mg vial', className: 'Proton pump inhibitors', note: '' },
    { a: 'Brufen 400mg Tab', b: 'Voltarin 75mg Amp', className: 'NSAIDs', note: '' },
  ]
  const [patient] = interactionsForChart(chart, [], dbPairs, duplicates)
  assert.deepEqual(patient.pairs.map((pair) => [pair.a, pair.severity, pair.note]), [
    ['Amikacin 500mg Vial', 'major', ''],
    ['Brufen 400mg Tab', 'moderate', 'Duplicate therapy: NSAIDs'],
    ['Risek 20mg cap', 'duplicate', 'Duplicate therapy: Proton pump inhibitors'],
  ])
})

test('RENAL_EQUATIONS match ClinCalc.com (values read from its calculator), and are null on missing input', () => {
  const E = RENAL_EQUATIONS
  const r = (equation, x) => Math.round(E[equation].calc(x))
  const m60 = { age: 60, weightKg: 72, heightCm: 170, female: false, black: false, scr: 1 }
  assert.deepEqual([r('cg', m60), r('ckd2021', m60), r('ckd2009', m60), r('mdrd', m60), r('jelliffe73', m60)], [65, 91, 86, 81, 62])
  assert.equal(Math.round(E.ckd2021.calc({ age: 60, female: false, scr: 1 })), 86) // per 1.73 m² without height and weight
  assert.equal(r('cg', { age: 70, weightKg: 50, heightCm: 175, female: false, scr: 0.8 }), 37) // underweight: actual × 0.69
  const obese = { age: 55, weightKg: 100, heightCm: 160, female: true, scr: 1.2 }
  assert.deepEqual([r('cg', obese), r('salazar', obese)], [53, 61]) // adjusted body weight
  assert.equal(r('cg', { ...m60, scr: 176.8 / SCR_UMOL_PER_MGDL, weightKg: 0 }) === null, false)
  const rising = { age: 60, weightKg: 72, heightCm: 170, female: false, scr: 1, scr2: 1.6, hours: 24 }
  assert.deepEqual(['jelliffe72', 'chiou', 'chen'].map((k) => r(k, rising)), [34, 35, 26])
  assert.deepEqual(['jelliffe72', 'chiou', 'chen'].map((k) => r(k, { ...rising, scr: 1.6, scr2: 1 })), [66, 59, 41])
  assert.equal(E.cg.calc({ ...m60, heightCm: 0 }), null)
  assert.equal(E.chen.calc({ ...rising, scr2: 0 }), null)
})

test('renalGuidance picks the first step the CrCl meets, the lowest below all, and HD on dialysis', () => {
  const rule = { steps: [[51, 'No change'], [26, '1 g q12h'], [10, '500 mg q12h'], [0, '500 mg q24h']], hd: 'after HD' }
  assert.deepEqual([80, 51, 50.9, 26, 12, 3].map((crcl) => renalGuidance(rule, crcl, false)), ['No change', 'No change', '1 g q12h', '1 g q12h', '500 mg q12h', '500 mg q24h'])
  assert.equal(renalGuidance(rule, 80, true), 'after HD')
})

test('chart device copy: remembered, recalled, dropped by logout and by a past day', () => {
  const store = new Map()
  globalThis.localStorage = { get length() { return store.size }, key: (i) => [...store.keys()][i] ?? null, getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) }
  const state = { patientNames: ['Ali'], patientIds: [''], columnMedicines: ['A'], quantities: [['2']] }
  rememberChart('k-today', '2026-10-05', 4, state)
  rememberChart('k-old', '2026-10-04', 2, state)
  localStorage.setItem('cpa-chart-draft:k-today', '{}')
  assert.deepEqual(recallChart('k-today'), { date: '2026-10-05', version: 4, state })
  assert.equal(recallChart('missing'), null)
  forgetChartCopies('2026-10-05')
  assert.equal(recallChart('k-old'), null)
  assert.ok(recallChart('k-today'))
  forgetChartCopies()
  assert.equal(recallChart('k-today'), null)
  assert.equal(localStorage.getItem('cpa-chart-draft:k-today'), '{}')
  delete globalThis.localStorage
})

test('pillChanges sends only what changed since the last sync; a removed entry or room goes out blank', () => {
  const base = { entries: { '1:a': { doseTime: 'x' }, '2:a': { doseTime: 'y' }, '3:a': { doseTime: 'z' } }, rooms: { 1: '5', 2: '6' } }
  const current = { entries: { '1:a': { doseTime: 'x' }, '2:a': { doseTime: 'w' } }, rooms: { 1: '5', 3: '9' } }
  const { entries, rooms } = pillChanges(base, current)
  assert.deepEqual(entries.map((entry) => [entry.patientRowNumber, entry.doseTime]).sort(), [[2, 'w'], [3, '']])
  assert.deepEqual(rooms, { 2: '', 3: '9' })
})

test('averagePatients divides by the days a chart was made, not the days in the range', () => {
  const rows = [
    { floor: 5, ward: null, date: '2026-05-01', count: 10 }, { floor: 5, ward: null, date: '2026-05-02', count: 20 },
    { floor: 2, ward: null, date: '2026-05-01', count: 6 },
    { floor: null, ward: 'ردهة العناية المركزة', date: '2026-05-03', count: 4 },
  ]
  const { locations, total } = averagePatients(rows, [2, 3, 5, 'ردهة العناية المركزة'])
  assert.deepEqual(locations.map((row) => [row.key, row.chartedDays, row.patientDays, row.average]), [
    [2, 1, 6, 6], [3, 0, 0, null], [5, 2, 30, 15], ['ردهة العناية المركزة', 1, 4, 4],
  ])
  // Hospital: 16 + 20 + 4 over the 3 days anything was charted.
  assert.deepEqual(total, { chartedDays: 3, patientDays: 40, average: 13.3 })
  assert.equal(averagePatients([], [5]).total.average, null)
})
