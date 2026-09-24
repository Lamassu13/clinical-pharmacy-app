import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeKeyedSnapshots, diffKeyedMergeOutcome, enqueueExtraPillsOp, applyExtraPillsQueue, EXTRA_PILL_SLOTS, isDraftStale } from './helpers.js'

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
