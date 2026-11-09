import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'
import { dayLockSettings } from './day-lock.js'

// «Albumin follow up» sheet: saved only over the version a device read (two devices never overwrite each other unseen), refused on a
// past day for a floor user, and an old app (no version sent) still saves.
let server, baseUrl
test.before(async () => { ({ server, baseUrl } = await startServer(app)) })
test.after(async () => { server.close(); await pool.end() })
test.beforeEach(() => resetDatabase())

const loginAs = async (options) => {
  const user = await createUser(options)
  const client = new ApiClient(baseUrl)
  assert.equal((await client.post('/api/auth/login', { username: user.username, password: user.password })).status, 200)
  return client
}
const doc = (notes) => ({ extraRows: [], notIndicated: [], notes })

test('albumin sheet: versioned saves — a second device saving over an old version gets 409 and the sheet as it is', async () => {
  const pharmacist = await loginAs({ role: 'user', floor: 3 })
  const date = '2026-11-09'
  const read = async () => (await pharmacist.get(`/api/albumin-followup?date=${date}&floor=3`)).body
  const first = await read()
  assert.equal(first.version, '')
  const saved = await pharmacist.put('/api/albumin-followup', { date, floor: 3, doc: doc('one'), version: '' })
  assert.equal(saved.status, 200)
  assert.ok(saved.body.version)
  // A second device that read the sheet before that save: refused, and given the saved sheet.
  const stale = await pharmacist.put('/api/albumin-followup', { date, floor: 3, doc: doc('two'), version: '' })
  assert.equal(stale.status, 409)
  assert.equal(stale.body.doc.notes, 'one')
  // Saving over the version just returned works; the next save over the new one too.
  const next = await pharmacist.put('/api/albumin-followup', { date, floor: 3, doc: doc('three'), version: saved.body.version })
  assert.equal(next.status, 200)
  assert.equal((await pharmacist.put('/api/albumin-followup', { date, floor: 3, doc: doc('four'), version: next.body.version })).status, 200)
  assert.equal((await read()).doc.notes, 'four')
  // An app from before the check (no version at all) saves as before.
  assert.equal((await pharmacist.put('/api/albumin-followup', { date, floor: 3, doc: doc('old app') })).status, 200)
  assert.equal((await read()).doc.notes, 'old app')
})

test('albumin sheet: a past day is read-only for a floor user (and editable for a manager)', async (t) => {
  dayLockSettings.enabled = true
  t.after(() => { dayLockSettings.enabled = false })
  const pharmacist = await loginAs({ role: 'user', floor: 3 })
  const manager = await loginAs({ role: 'admin' })
  const past = '2026-01-05'
  assert.equal((await pharmacist.get(`/api/albumin-followup?date=${past}&floor=3`)).body.locked, true)
  const refused = await pharmacist.put('/api/albumin-followup', { date: past, floor: 3, doc: doc('x'), version: '' })
  assert.equal(refused.status, 403)
  assert.equal(refused.body.dayLocked, true)
  assert.equal((await manager.get(`/api/albumin-followup?date=${past}&floor=3`)).body.locked, false)
  assert.equal((await manager.put('/api/albumin-followup', { date: past, floor: 3, doc: doc('x'), version: '' })).status, 200)
})
