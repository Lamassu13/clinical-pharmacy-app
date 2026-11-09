import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'
import { sampleBodies, compareForm, allowCheckNow } from './google-form-health.js'
import { liveForm } from '../shared/google-form-check.js'
import { GOOGLE_FORMS } from './google-forms.js'

const FLOOR = 5
const WARD = 'ردهة رجال'
const OTHER = { floor: 8, ward: 'الردهة الخامسة' }

let server, baseUrl
// The follow-up screen starts a Google Form health check in the background when the last one is old: Google is never reached from a test.
const realFetch = globalThis.fetch
let googleHtml = ''
test.before(async () => {
  ({ server, baseUrl } = await startServer(app))
  globalThis.fetch = (url, options) => (String(url).includes('docs.google.com') ? Promise.resolve({ ok: true, text: async () => googleHtml }) : realFetch(url, options))
})
test.after(async () => { globalThis.fetch = realFetch; server.close(); await pool.end() })
test.beforeEach(() => resetDatabase())

const loginAs = async (options) => {
  const user = await createUser(options)
  const client = new ApiClient(baseUrl)
  assert.equal((await client.post('/api/auth/login', { username: user.username, password: user.password })).status, 200)
  return client
}
const saveChart = (client, date, medicine, rows, floor = FLOOR, ward = WARD) => client.put('/api/chart', {
  floor, ward, date, slot: 'main', expectedVersion: 0,
  patients: rows.map((row, index) => ({ rowNumber: index + 1, name: row.name, patientId: row.id || '' })),
  columns: [{ columnNumber: 1, medicineName: medicine }],
  quantities: rows.flatMap((row, index) => (row.qty ? [{ rowNumber: index + 1, columnNumber: 1, quantity: row.qty }] : [])),
})
const form = (client, body) => client.post('/api/drug-requests', { floor: FLOOR, ward: WARD, fields: {}, ...body })
const followup = (client, query = 'from=2026-11-03&to=2026-11-09') => client.get(`/api/drug-requests/followup?${query}`)
const COMPLETE_IVIG = { sex: 'أنثى', age: '5', vials: '4', doctor: 'د. سعد' }

test('followup: managers only; what needs following up, in short rows — unsent, refused, unconfirmed and incomplete; sent forms are not read', async () => {
  const manager = await loginAs({ role: 'supervisor' })
  const pharmacist = await loginAs({ role: 'user', floor: FLOOR })
  assert.equal((await followup(pharmacist)).status, 403)
  assert.equal((await followup(manager, 'from=2026-11-09&to=2026-11-03')).status, 400)
  assert.equal((await followup(manager, 'from=2026-01-01&to=2026-11-09')).status, 400) // longer than a month
  assert.equal((await followup(manager, 'from=bad&to=2026-11-09')).status, 400)

  const sent = (await form(pharmacist, { kind: 'ivig', date: '2026-11-09', name: 'مرسلة', patientId: '1', fields: COMPLETE_IVIG })).body.request
  await pharmacist.patch(`/api/drug-requests/${sent.id}/ticks`, { ticks: ['gbs'] })
  await pharmacist.post(`/api/drug-requests/${sent.id}/google-form`, { confirmManual: true })
  const unsent = (await form(pharmacist, { kind: 'ivig', date: '2026-11-08', name: 'لم تُرسل', patientId: '2', fields: COMPLETE_IVIG })).body.request
  await pharmacist.patch(`/api/drug-requests/${unsent.id}/ticks`, { ticks: ['gbs'] })
  await form(pharmacist, { kind: 'ivig', date: '2026-11-07', name: 'ناقصة', patientId: '3' })
  await form(pharmacist, { kind: 'meropenem', date: '2026-11-09', name: 'ميروبينيم ناقص', patientId: '4', fields: { sex: 'ذكر' } })
  const complete = (await form(pharmacist, { kind: 'meropenem', date: '2026-11-09', name: 'ميروبينيم تام', patientId: '5', fields: { sex: 'ذكر', age: '40' } })).body.request
  await pharmacist.patch(`/api/drug-requests/${complete.id}/ticks`, { ticks: ['cap'] })
  // An old one, outside the range.
  await form(pharmacist, { kind: 'ivig', date: '2026-10-01', name: 'قديمة', patientId: '6' })

  const { body } = await followup(manager)
  const byName = Object.fromEntries(body.rows.map((row) => [row.name, row]))
  assert.deepEqual(Object.keys(byName).sort(), ['ميروبينيم ناقص', 'ناقصة', 'لم تُرسل'].sort())
  assert.equal(byName['لم تُرسل'].state, 'unsent')
  assert.equal(byName['لم تُرسل'].problems, undefined) // complete: no list of what it lacks
  assert.equal(byName['ناقصة'].state, 'unsent')
  assert.ok(byName['ناقصة'].problems.includes('التشخيص (علّم مربعًا)'))
  assert.deepEqual([byName['ميروبينيم ناقص'].state, byName['ميروبينيم ناقص'].problems], ['incomplete', ['العمر', 'التشخيص']])
  assert.equal(byName['لم تُرسل'].ward, `${FLOOR}|${WARD}`)
  assert.equal(body.more, false)
  assert.deepEqual((await followup(manager, 'from=2026-11-03&to=2026-11-09&kind=meropenem')).body.rows.map((row) => row.name), ['ميروبينيم ناقص'])
})

test('followup: a form with no رقم الطبلة of its own takes the one on that day’s chart, so it is not reported as lacking it', async () => {
  const manager = await loginAs({ role: 'admin' })
  await manager.post('/api/medicines', { name: 'Tygacil 50mg Vial' })
  const pharmacist = await loginAs({ role: 'user', floor: FLOOR })
  const fields = { sex: 'أنثى', age: '40', weight: '70', scr: '1.1', dose: '100', duration: '7 أيام', culture: 'Sensitive', committee: 'ص. ليث', doctor: 'د. سعد' }
  const saved = (await form(pharmacist, { kind: 'tigecycline', date: '2026-11-09', name: 'سارة', patientId: '', fields })).body.request
  await pharmacist.patch(`/api/drug-requests/${saved.id}/ticks`, { ticks: ['skin'] })
  const before = (await followup(manager)).body.rows.find((row) => row.name === 'سارة')
  assert.ok(before.problems.includes('رقم الطبلة')) // no chart carries it yet
  await saveChart(pharmacist, '2026-11-09', 'Tygacil 50mg Vial', [{ name: 'سارة', id: '44', qty: 2 }])
  const after = (await followup(manager)).body.rows.find((row) => row.name === 'سارة')
  assert.deepEqual([after.state, after.patientId, after.problems], ['unsent', '44', undefined])
})

test('missing: patients given a first-day medicine with no form — none within 30 days before / 14 after; a floor user sees their own ward only', async () => {
  const admin = await loginAs({ role: 'admin' })
  await admin.post('/api/medicines', { name: 'IVIG 5g vial' })
  const pharmacist = await loginAs({ role: 'user', floor: FLOOR })
  await saveChart(pharmacist, '2026-11-09', 'IVIG 5g vial', [{ name: 'بلا استمارة', id: '11', qty: 2 }, { name: 'لها استمارة', id: '12', qty: 2 }, { name: 'استمارة قديمة', id: '13', qty: 2 }, { name: 'استمارة بعيدة', id: '14', qty: 2 }, { name: 'بلا جرعة', id: '15' }])
  await saveChart(admin, '2026-11-09', 'IVIG 5g vial', [{ name: 'ردهة أخرى', id: '21', qty: 1 }], OTHER.floor, OTHER.ward)
  await form(pharmacist, { kind: 'ivig', date: '2026-11-09', name: 'لها استمارة', patientId: '12' })
  await form(pharmacist, { kind: 'ivig', date: '2026-10-20', name: 'استمارة قديمة', patientId: '13' }) // 20 days before: still counts
  await form(pharmacist, { kind: 'ivig', date: '2026-09-20', name: 'استمارة بعيدة', patientId: '14' }) // 50 days before: a new course
  await form(pharmacist, { kind: 'colistin', date: '2026-11-09', name: 'بلا استمارة', patientId: '11' }) // another kind's form is not this kind's

  const mine = await pharmacist.get(`/api/drug-requests/missing?kind=ivig&floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=2026-11-09`)
  assert.equal(mine.status, 200)
  assert.deepEqual(mine.body.patients.map((row) => [row.name, row.patientId]).sort(), [['استمارة بعيدة', '14'], ['بلا استمارة', '11']])
  assert.equal((await pharmacist.get(`/api/drug-requests/missing?kind=ivig&floor=${OTHER.floor}&ward=${encodeURIComponent(OTHER.ward)}&date=2026-11-09`)).status, 403)
  assert.equal((await pharmacist.get('/api/drug-requests/missing?kind=ivig&from=2026-11-03&to=2026-11-09')).status, 403) // all wards: managers
  assert.equal((await pharmacist.get(`/api/drug-requests/missing?kind=albumin&floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=2026-11-09`)).status, 400) // asked every day, not on a first day
  assert.equal((await pharmacist.get(`/api/drug-requests/missing?kind=nope&floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=2026-11-09`)).status, 400)

  // A manager: every ward, a range; the patient is listed once, at the first day in the range.
  await saveChart(pharmacist, '2026-11-10', 'IVIG 5g vial', [{ name: 'بلا استمارة', id: '11', qty: 2 }])
  const all = await admin.get('/api/drug-requests/missing?kind=ivig&from=2026-11-09&to=2026-11-15')
  assert.deepEqual(all.body.patients.map((row) => [row.ward, row.name, row.date]).sort(), [
    [OTHER.ward, 'ردهة أخرى', '2026-11-09'], [WARD, 'استمارة بعيدة', '2026-11-09'], [WARD, 'بلا استمارة', '2026-11-09'],
  ].sort())

  // A course already running before the range is told from a new one: its form (made on its first day, before the range) counts,
  // and a patient who began before the form went live (2026-11-09 for IVIG) is never asked for one.
  await saveChart(pharmacist, '2026-11-05', 'IVIG 5g vial', [{ name: 'قبل الإطلاق', id: '31', qty: 1 }])
  await saveChart(pharmacist, '2026-11-12', 'IVIG 5g vial', [{ name: 'قبل الإطلاق', id: '31', qty: 1 }, { name: 'مستمرة', id: '32', qty: 1 }, { name: 'بدأت الآن', id: '33', qty: 1 }])
  await form(pharmacist, { kind: 'ivig', date: '2026-11-09', name: 'مستمرة', patientId: '32' }) // the course began on 11-09, with a form
  await saveChart(pharmacist, '2026-11-10', 'IVIG 5g vial', [{ name: 'مستمرة', id: '32', qty: 1 }])
  const later = await admin.get('/api/drug-requests/missing?kind=ivig&from=2026-11-12&to=2026-11-15')
  const names = later.body.patients.map((row) => row.name)
  assert.equal(names.includes('مستمرة'), false) // still on the course whose form exists
  assert.equal(names.includes('قبل الإطلاق'), false) // began before the forms existed
  assert.equal(names.includes('بدأت الآن'), true)
  assert.equal(names.includes('بلا استمارة'), false) // not charted in this range
})

test('dashboard: a manager’s answer carries how many Google forms of the week are not sent; a pharmacist’s does not', async () => {
  const manager = await loginAs({ role: 'admin' })
  const pharmacist = await loginAs({ role: 'user', floor: FLOOR })
  const today = new Date().toISOString().slice(0, 10)
  await form(pharmacist, { kind: 'ivig', date: today, name: 'نور', patientId: '1', fields: COMPLETE_IVIG })
  await form(pharmacist, { kind: 'meropenem', date: today, name: 'ميرو', patientId: '2' }) // sent nowhere: not counted here
  assert.equal((await manager.get(`/api/dashboard?date=${today}`)).body.formsToSend, 1)
  assert.equal((await pharmacist.get(`/api/dashboard?date=${today}`)).body.formsToSend, undefined)
})

// A live form's page as Google draws it, built from the answers the app sends: every question free text unless `choices` says
// (id → its option texts); `drop` removes questions, `extra` adds required ones (title by id), `signIn` is the email setting.
const livePage = (kind, { choices = {}, drop = [], extra = {}, extraPage = 0, signIn = GOOGLE_FORMS[kind].signIn } = {}) => {
  const ids = [...new Set(sampleBodies(kind).flatMap((body) => body.map(([name]) => /^entry\.(\d+)/.exec(name)?.[1]).filter(Boolean)))].filter((id) => !drop.includes(id))
  const question = (id, title) => [Number(id), title, null, choices[id] ? 2 : 0, [[Number(id), choices[id] ? choices[id].map((text) => [text]) : null, 1]]]
  const questions = [[1, 'title block', '', 11, null], ...ids.map((id) => question(id, `q${id}`)), ...Array.from({ length: extraPage }, (_, index) => [100 + index, 'section', null, 8, null]), ...Object.entries(extra).map(([id, title]) => question(id, title))]
  return `<script>var FB_PUBLIC_LOAD_DATA_ = ${JSON.stringify([null, [null, questions, null, null, null, null, null, null, null, null, [null, null, null, 2, null, null, signIn ? 2 : 1]]])};</script>`
}

test('google form health: a form as the app expects is ok; a question gone, an option reworded, a NEW required question or a changed sign-in is not', () => {
  for (const kind of Object.keys(GOOGLE_FORMS)) {
    assert.ok(sampleBodies(kind).length > 0, `${kind}: sample answers are built`)
    assert.deepEqual(compareForm(kind, liveForm(livePage(kind))), { status: 'ok', detail: '' }, kind)
  }
  const goneId = GOOGLE_FORMS.ivig && '700571695' // the IVIG form's institution question
  assert.match(compareForm('ivig', liveForm(livePage('ivig', { drop: [goneId] }))).detail, /لم يعد في النموذج: سؤال غير موجود \(700571695\)/)
  // The diagnosis' part question loses «others»: the answer for that branch is no longer one of its options.
  const reworded = compareForm('ivig', liveForm(livePage('ivig', { choices: { 1082107107: ['Part ( neurology)', 'Part ( hematology )', 'Part ( nephrology )'] } })))
  assert.equal(reworded.status, 'changed')
  assert.match(reworded.detail, /خيار غير موجود: «others»/)
  const added = compareForm('colistin', liveForm(livePage('colistin', { extra: { 999: 'رقم الهاتف' } })))
  assert.deepEqual([added.status, /سؤال إلزامي جديد: رقم الهاتف/.test(added.detail)], ['changed', true])
  // A required question on a page the app never takes (the albumin form's «other diagnosis» branch) is not asked of it.
  assert.deepEqual(compareForm('ivig', liveForm(livePage('ivig', { extra: { 999: 'other diagnosis' }, extraPage: 8 }))), { status: 'ok', detail: '' })
  assert.match(compareForm('ivig', liveForm(livePage('ivig', { signIn: true }))).detail, /يشترط تسجيل الدخول/)
  assert.match(compareForm('tigecycline', liveForm(livePage('tigecycline', { signIn: false }))).detail, /لم يعد النموذج يشترط/)
})

test('google form health: kept per form, shown to managers with the follow-up (stale → refreshed in the background), checked on demand, on the dashboard', async () => {
  const manager = await loginAs({ role: 'admin' })
  const pharmacist = await loginAs({ role: 'user', floor: FLOOR })
  const today = new Date().toISOString().slice(0, 10)
  googleHtml = livePage('ivig') // one canned page for every form: ivig's own is ok, the others are not (their questions are not on it)
  allowCheckNow()
  assert.equal((await pharmacist.post('/api/drug-requests/health/check', {})).status, 403)
  const checked = (await manager.post('/api/drug-requests/health/check', {})).body.health
  assert.deepEqual(checked.issues.map((issue) => issue.kind).sort(), ['albumin', 'colistin', 'tigecycline'])
  assert.ok(checked.issues.every((issue) => issue.status === 'changed' && issue.detail))
  assert.ok(checked.checkedAt)
  assert.equal((await manager.get(`/api/dashboard?date=${today}`)).body.formsChanged, 3)
  assert.equal((await pharmacist.get(`/api/dashboard?date=${today}`)).body.formsChanged, undefined)
  // The follow-up answer carries the kept verdicts.
  assert.equal((await manager.get(`/api/drug-requests/followup?from=${today}&to=${today}`)).body.health.issues.length, 3)

  // Asked again at once: Google is not asked again (a minute's cooldown) — the kept verdicts come back.
  googleHtml = livePage('ivig', { drop: ['700571695'] })
  assert.equal((await manager.post('/api/drug-requests/health/check', {})).body.health.issues.length, 3)
  // After the cooldown the next check sees the change: now ivig is changed too.
  allowCheckNow()
  assert.equal((await manager.post('/api/drug-requests/health/check', {})).body.health.issues.length, 4)
})

test('google form send: a refusal because the form now asks a new required question says so, and the form is marked changed', async (t) => {
  process.env.GOOGLE_FORM_SEND = '1'
  t.after(() => { delete process.env.GOOGLE_FORM_SEND })
  const pharmacist = await loginAs({ role: 'user', floor: FLOOR })
  const manager = await loginAs({ role: 'admin' })
  const saved = (await form(pharmacist, { kind: 'ivig', date: '2026-11-09', name: 'نور', patientId: '66', fields: COMPLETE_IVIG })).body.request
  await pharmacist.patch(`/api/drug-requests/${saved.id}/ticks`, { ticks: ['gbs'] })
  let page = livePage('ivig', { extra: { 999: 'اسم المسؤول عن الردهة' } })
  const posts = []
  globalThis.fetch = (url, options) => {
    if (!String(url).includes('docs.google.com')) return realFetch(url, options)
    if (String(url).endsWith('formResponse')) { posts.push(url); return Promise.resolve({ ok: false, status: 400, redirected: false, url: String(url) }) }
    return Promise.resolve({ ok: true, text: async () => page })
  }
  t.after(() => { globalThis.fetch = (url, options) => (String(url).includes('docs.google.com') ? Promise.resolve({ ok: true, text: async () => googleHtml }) : realFetch(url, options)) })
  const refused = await pharmacist.post(`/api/drug-requests/${saved.id}/google-form`, {})
  assert.equal(refused.status, 502)
  assert.match(refused.body.message, /سؤال إلزامي جديد: اسم المسؤول عن الردهة/)
  assert.ok(refused.body.manualUrl)
  assert.equal(posts.length, 1)
  const today = new Date().toISOString().slice(0, 10)
  assert.equal((await manager.get(`/api/dashboard?date=${today}`)).body.formsChanged, 1)
  // The form as the app expects it, a refusal all the same: then it is a value that was refused (the old message).
  page = livePage('ivig')
  const value = await pharmacist.post(`/api/drug-requests/${saved.id}/google-form`, {})
  assert.match(value.body.message, /رفض نموذج Google إحدى القيم/)
  assert.equal((await manager.get(`/api/dashboard?date=${today}`)).body.formsChanged, 0) // and its health is ok again
})
