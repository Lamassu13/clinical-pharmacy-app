import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'

let server, baseUrl
test.before(async () => { ({ server, baseUrl } = await startServer(app)) })
test.after(async () => { server.close(); await pool.end() })
test.beforeEach(async () => { await resetDatabase() })

const signedIn = async (role) => {
  const user = await createUser({ role })
  const client = new ApiClient(baseUrl)
  assert.equal((await client.post('/api/auth/login', { username: user.username, password: user.password })).status, 200)
  return client
}
const names = async (client) => (await client.get('/api/medicines')).body.medicines.map((medicine) => medicine.name)

test('the catalogue always reflects an add, a rename and a delete made through the app', async () => {
  const manager = await signedIn('supervisor')
  assert.deepEqual(await names(manager), [])
  const created = await manager.post('/api/medicines', { name: 'Aspirin 100mg Tab' })
  assert.equal(created.status, 201)
  assert.deepEqual(await names(manager), ['Aspirin 100mg Tab'])
  const id = created.body.medicine.id
  assert.equal((await manager.put(`/api/medicines/${id}`, { name: 'Aspirin 75mg Tab' })).status, 200)
  assert.deepEqual(await names(manager), ['Aspirin 75mg Tab'])
  assert.equal((await manager.put(`/api/medicines/${id}`, { arabicName: 'أسبرين' })).status, 200)
  assert.equal((await manager.get('/api/medicines')).body.medicines[0].arabic_name, 'أسبرين')
  assert.equal((await manager.delete(`/api/medicines/${id}`)).status, 200)
  assert.deepEqual(await names(manager), [])
})

test('a refused write (duplicate, unknown id) leaves the cached list as it was', async () => {
  const manager = await signedIn('supervisor')
  await manager.post('/api/medicines', { name: 'Tazocin 4.5gm Vial' })
  assert.deepEqual(await names(manager), ['Tazocin 4.5gm Vial'])
  assert.equal((await manager.post('/api/medicines', { name: 'tazocin 4.5gm vial' })).status, 409)
  assert.equal((await manager.put('/api/medicines/999999', { name: 'x' })).status, 404)
  assert.deepEqual(await names(manager), ['Tazocin 4.5gm Vial'])
})

test('a pharmacist reads the same list, and an anonymous request is still refused', async () => {
  const manager = await signedIn('admin')
  const pharmacist = await signedIn('user')
  await manager.post('/api/medicines', { name: 'Plavix 75mg tab' })
  assert.deepEqual(await names(pharmacist), ['Plavix 75mg tab'])
  assert.equal((await new ApiClient(baseUrl).get('/api/medicines')).status, 401)
})
