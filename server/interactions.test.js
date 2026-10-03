import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { genericName } from './generic-names.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'

let server, baseUrl
test.before(async () => { ({ server, baseUrl } = await startServer(app)) })
test.after(async () => { server.close(); await pool.end() })
test.beforeEach(async () => {
  await resetDatabase()
  await pool.query('TRUNCATE drug_interactions')
  await pool.query("INSERT INTO drug_interactions (drug_a, drug_b, level) VALUES ('amikacin', 'furosemide', 'major'), ('acetylsalicylic acid', 'furosemide', 'moderate'), ('amikacin', 'warfarin', 'major')")
})

test('genericName strips strengths and forms and maps brands', () => {
  assert.equal(genericName('Amikacin 500mg Vial'), 'amikacin')
  assert.equal(genericName('Lasix 40mg Tab'), 'furosemide')
  assert.equal(genericName('Meronem 1000gm Vial'), 'meropenem')
  assert.equal(genericName('Aspirin 100mg Tab'), 'acetylsalicylic acid') // DDInter's spelling
  assert.equal(genericName('Lactulose Syp'), 'lactulose')
  assert.equal(genericName('Insulin soluble vial'), 'insulin human (regular)')
  assert.equal(genericName('  '), '')
})

test('GET /api/interactions answers with interacting pairs among the given medicines only', async () => {
  const user = await createUser({ role: 'user', floor: 5 })
  const client = new ApiClient(baseUrl)
  assert.equal((await client.post('/api/auth/login', { username: user.username, password: user.password })).status, 200)
  const names = ['Amikacin 500mg Vial', 'Lasix 40mg Tab', 'Lasix 20mg Amp', 'Aspirin 100mg Tab', 'IV Set']
  const result = await client.get(`/api/interactions?${names.map((name) => `name=${encodeURIComponent(name)}`).join('&')}`)
  assert.equal(result.status, 200)
  const seen = result.body.pairs.map((pair) => `${pair.a}|${pair.b}|${pair.level}`).sort()
  assert.deepEqual(seen, [
    'Amikacin 500mg Vial|Lasix 20mg Amp|major', 'Amikacin 500mg Vial|Lasix 40mg Tab|major',
    'Aspirin 100mg Tab|Lasix 20mg Amp|moderate', 'Aspirin 100mg Tab|Lasix 40mg Tab|moderate',
  ].sort()) // warfarin was not asked about, so its pair is absent
  assert.deepEqual(result.body.duplicates, [])
  assert.deepEqual((await client.get('/api/interactions?name=Aspirin')).body.pairs, [])
  // Two PPIs are a duplicate; one PPI in two strengths is not.
  const ppis = ['Risek 20mg cap', 'Omeprazole 40mg vial', 'Pantoprazole 40mg vial', 'Lasix 40mg Tab']
  const dup = await client.get(`/api/interactions?${ppis.map((name) => `name=${encodeURIComponent(name)}`).join('&')}`)
  assert.deepEqual(dup.body.duplicates.map((pair) => `${pair.a}|${pair.b}|${pair.className}`), [
    'Risek 20mg cap|Pantoprazole 40mg vial|Proton pump inhibitors', 'Omeprazole 40mg vial|Pantoprazole 40mg vial|Proton pump inhibitors',
  ])
  assert.equal((await new ApiClient(baseUrl).get('/api/interactions?name=a&name=b')).status, 401)
})

test('GET /api/renal-doses returns the rule for each known medicine by name, nothing else', async () => {
  const user = await createUser({ role: 'user', floor: 5 })
  const client = new ApiClient(baseUrl)
  assert.equal((await client.post('/api/auth/login', { username: user.username, password: user.password })).status, 200)
  const res = await client.get(`/api/renal-doses?name=${encodeURIComponent('Meronem 1000gm Vial')}&name=${encodeURIComponent('Lasix 40mg Tab')}`)
  assert.equal(res.status, 200)
  assert.deepEqual(Object.keys(res.body.rules), ['Meronem 1000gm Vial'])
  assert.equal(res.body.rules['Meronem 1000gm Vial'].generic, 'meropenem')
  assert.equal((await new ApiClient(baseUrl).get('/api/renal-doses?name=a')).status, 401)
})
