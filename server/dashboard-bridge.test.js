import test from 'node:test'
import assert from 'node:assert/strict'
import { bridgedDailyCounts } from './dashboard-bridge.js'

const row = (date, patient, wardId = 1) => ({ wardId, floor: 2, ward: 'A', date, patient })

test('Friday between Thursday and Saturday counts the patients on both', () => {
  const rows = [row('2026-10-15', 'x'), row('2026-10-15', 'y'), row('2026-10-17', 'x'), row('2026-10-17', 'z')]
  const counts = bridgedDailyCounts(rows, '2026-10-15', '2026-10-17')
  assert.deepEqual(counts.map((c) => [c.date, c.count]), [['2026-10-15', 2], ['2026-10-16', 1], ['2026-10-17', 2]])
})

test('a charted empty day breaks the bridge; padding days outside the range are dropped', () => {
  const rows = [row('2026-10-13', 'x'), row('2026-10-14', null), row('2026-10-16', 'x')]
  const counts = bridgedDailyCounts(rows, '2026-10-14', '2026-10-16')
  assert.deepEqual(counts.map((c) => [c.date, c.count]), [['2026-10-16', 1]])
})
