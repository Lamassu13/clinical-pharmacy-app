import { test } from 'node:test'
import assert from 'node:assert/strict'
import { interactionsForChart, mergeKeyedSnapshots, diffKeyedMergeOutcome, enqueueExtraPillsOp, applyExtraPillsQueue, EXTRA_PILL_SLOTS, isDraftStale, mergePreviousDayDoses, medicineMatches, pillSheetPlan, yesterdaySchedules, scheduleFor, applyTemplateColumns, catalogueMatches } from './helpers.js'

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

test('isDraftStale is false only when the draft date matches today', () => {
  assert.equal(isDraftStale({ date: '2026-09-22' }, '2026-09-22'), false)
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
  assert.deepEqual(result.columns.slice(0, 4), ['Meronem 1000gm Vial', 'IV Set', 'Amoxil 500mg Cap', ''])
  assert.equal(result.columns.length, 51)
  assert.equal(result.dropped, 1)
  assert.deepEqual(result.quantities.map((row) => row.slice(0, 3)), [['', '1', ''], ['', '', ''], ['', '1', '']]) // giving set seeded for named rows only
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
