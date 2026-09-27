import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'

let server, baseUrl
test.before(async () => { ({ server, baseUrl } = await startServer(app)) })
test.after(async () => { server.close(); await pool.end() })
test.beforeEach(async () => {
  await resetDatabase()
  await pool.query("INSERT INTO medicines (name) VALUES ('Amoxil 500mg Cap'), ('Meronem 1000gm Vial'), ('IV Set')")
})

const loginAs = async (options) => {
  const user = await createUser(options)
  const client = new ApiClient(baseUrl)
  assert.equal((await client.post('/api/auth/login', { username: user.username, password: user.password })).status, 200)
  return client
}

test('medicine templates: personal, snapped to the catalogue, upserted by name', async () => {
  const mine = await loginAs({ role: 'user', floor: 5 })
  const saved = await mine.post('/api/templates', { name: ' اعتيادي ', medicines: ['meronem  1000gm vial', 'Not In Catalogue', 'Amoxil 500mg Cap', 'MERONEM 1000GM VIAL', ''] })
  assert.equal(saved.status, 200)
  assert.deepEqual(saved.body.template.medicines, ['Meronem 1000gm Vial', 'Amoxil 500mg Cap'])
  assert.equal(saved.body.template.name, 'اعتيادي')

  const again = await mine.post('/api/templates', { name: 'اعتيادي', medicines: ['IV Set'] })
  assert.equal(again.body.template.id, saved.body.template.id) // same name replaces it
  const list = (await mine.get('/api/templates')).body.templates
  assert.deepEqual(list.map((t) => [t.name, t.medicines]), [['اعتيادي', ['IV Set']]])

  assert.equal((await mine.post('/api/templates', { name: 'فارغ', medicines: ['Nope'] })).status, 400)
  assert.equal((await mine.post('/api/templates', { name: '  ', medicines: ['IV Set'] })).status, 400)

  const other = await loginAs({ role: 'admin' })
  assert.deepEqual((await other.get('/api/templates')).body.templates, [])
  assert.equal((await other.delete(`/api/templates/${saved.body.template.id}`)).status, 404)
  assert.equal((await mine.delete(`/api/templates/${saved.body.template.id}`)).status, 200)
  assert.deepEqual((await mine.get('/api/templates')).body.templates, [])

  assert.equal((await new ApiClient(baseUrl).get('/api/templates')).status, 401)
})
