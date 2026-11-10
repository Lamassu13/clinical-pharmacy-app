import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'
import { sampleBodies, compareForm, allowCheckNow, saveHealth } from './google-form-health.js'
import { liveForm } from '../shared/google-form-check.js'
import { ivigFormAnswers } from '../shared/ivig-google-form.js'
import { needsFollowUp, formProblems } from '../shared/form-problems.js'
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
const livePage = (kind, { choices = {}, drop = [], extra = {}, extraPage = 0, signIn = GOOGLE_FORMS[kind].signIn, settings = true } = {}) => {
  const ids = [...new Set(sampleBodies(kind).flatMap((body) => body.map(([name]) => /^entry\.(\d+)/.exec(name)?.[1]).filter(Boolean)))].filter((id) => !drop.includes(id))
  const question = (id, title) => [Number(id), title, null, choices[id] ? 2 : 0, [[Number(id), choices[id] ? choices[id].map((text) => [text]) : null, 1]]]
  const questions = [[1, 'title block', '', 11, null], ...ids.map((id) => question(id, `q${id}`)), ...Array.from({ length: extraPage }, (_, index) => [100 + index, 'section', null, 8, null]), ...Object.entries(extra).map(([id, title]) => question(id, title))]
  return `<script>var FB_PUBLIC_LOAD_DATA_ = ${JSON.stringify([null, [null, questions, ...(settings ? [null, null, null, null, null, null, null, null, [null, null, null, 2, null, null, signIn ? 2 : 1]] : [])]])};</script>`
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
  // A page that does not carry the email setting (Google moved it) is unknown, not «no sign-in»: no alarm.
  const unknown = liveForm(livePage('tigecycline', { settings: false }))
  assert.equal(unknown.signIn, null)
  assert.deepEqual(compareForm('tigecycline', unknown), { status: 'ok', detail: '' })
  // The samples vary on more than the case: both sexes, every culture result, no days, every month.
  assert.ok(sampleBodies('albumin').length >= 17 + 16 && sampleBodies('tigecycline').length >= 2 + 16)
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

  // A check that could not read the form never erases a «changed» verdict (only the check time moves on).
  await saveHealth('colistin', { status: 'unreachable', detail: 'تعذّر الوصول إلى Google' })
  const kept = (await manager.get(`/api/drug-requests/followup?from=${today}&to=${today}`)).body.health.issues.find((issue) => issue.kind === 'colistin')
  assert.deepEqual([kept.status, /سؤال|لم يعد/.test(kept.detail)], ['changed', true])

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
  // The live form as far as this send goes: the questions of the other cases (other pages on the real form) left out.
  const onPath = new Set(ivigFormAnswers({ name: 'x', patientId: '1', date: '2026-11-09', ticks: ['gbs'], note: '', fields: COMPLETE_IVIG }).body.map(([name]) => /^entry\.(\d+)/.exec(name)?.[1]))
  const otherCases = [...new Set(sampleBodies('ivig').flatMap((body) => body.map(([name]) => /^entry\.(\d+)/.exec(name)?.[1])))].filter((id) => id && !onPath.has(id))
  let page = livePage('ivig', { drop: otherCases, extra: { 999: 'اسم المسؤول عن الردهة' } })
  const posts = []
  globalThis.fetch = (url, options) => {
    if (!String(url).includes('docs.google.com')) return realFetch(url, options)
    if (String(url).endsWith('formResponse')) { posts.push(url); return Promise.resolve({ ok: false, status: 400, redirected: false, url: String(url) }) }
    return Promise.resolve({ ok: true, text: async () => page })
  }
  t.after(() => { globalThis.fetch = (url, options) => (String(url).includes('docs.google.com') ? Promise.resolve({ ok: true, text: async () => googleHtml }) : realFetch(url, options)) })
  const refused = await pharmacist.post(`/api/drug-requests/${saved.id}/google-form`, {})
  assert.equal(refused.status, 502)
  assert.match(refused.body.message, /سؤال إلزامي جديد: اسم المسؤول عن الردهة\)/)
  assert.ok(refused.body.manualUrl)
  assert.equal(posts.length, 1)
  const today = new Date().toISOString().slice(0, 10)
  assert.equal((await manager.get(`/api/dashboard?date=${today}`)).body.formsChanged, 1)
  // The form as the app expects it, a refusal all the same: then it is a value that was refused (the old message).
  page = livePage('ivig', { drop: otherCases })
  const value = await pharmacist.post(`/api/drug-requests/${saved.id}/google-form`, {})
  assert.match(value.body.message, /رفض نموذج Google إحدى القيم/)
})

test('dashboard: a floor user gets their own wards’ forms still to follow up today (unsent or unfinished), nothing of other wards; a manager does not', async () => {
  const today = new Date().toISOString().slice(0, 10)
  const mine = await loginAs({ role: 'user', floor: FLOOR })
  const other = await loginAs({ role: 'user', floor: OTHER.floor })
  const manager = await loginAs({ role: 'admin' })
  // Two unsent on the ward, one sent and complete (not pending), one on another floor's ward, one yesterday (not today's alert).
  await form(mine, { kind: 'ivig', date: today, name: 'لم تُرسل', patientId: '1', fields: COMPLETE_IVIG })
  await form(mine, { kind: 'meropenem', date: today, name: 'ناقصة', patientId: '2' })
  const sent = (await form(mine, { kind: 'ivig', date: today, name: 'مرسلة', patientId: '3', fields: COMPLETE_IVIG })).body.request
  await mine.patch(`/api/drug-requests/${sent.id}/ticks`, { ticks: ['gbs'] })
  await mine.post(`/api/drug-requests/${sent.id}/google-form`, { confirmManual: true })
  await other.post('/api/drug-requests', { kind: 'ivig', floor: OTHER.floor, ward: OTHER.ward, date: today, name: 'أخرى', patientId: '4', fields: {} })
  await form(mine, { kind: 'ivig', date: '2000-01-01', name: 'قديمة', patientId: '5' })

  const own = (await mine.get(`/api/dashboard?date=${today}`)).body.formsPending
  assert.deepEqual(own, { total: 2, wards: [{ floor: FLOOR, ward: WARD, n: 2 }] })
  assert.deepEqual((await other.get(`/api/dashboard?date=${today}`)).body.formsPending, { total: 1, wards: [{ floor: OTHER.floor, ward: OTHER.ward, n: 1 }] })
  assert.equal((await manager.get(`/api/dashboard?date=${today}`)).body.formsPending, undefined)
  // A user with no assignment has nothing pending.
  const nobody = await loginAs({ role: 'user' })
  assert.deepEqual((await nobody.get(`/api/dashboard?date=${today}`)).body.formsPending, { total: 0, wards: [] })
  // One floor's own count, for whoever may open that floor: a manager any floor, a floor user theirs only.
  const pending = (client, floor, date = today) => client.get(`/api/drug-requests/pending?floor=${floor}&date=${date}`)
  assert.deepEqual((await pending(manager, FLOOR)).body, own)
  assert.deepEqual((await pending(manager, OTHER.floor)).body, { total: 1, wards: [{ floor: OTHER.floor, ward: OTHER.ward, n: 1 }] })
  assert.deepEqual((await pending(manager, 3)).body, { total: 0, wards: [] })
  assert.deepEqual((await pending(mine, FLOOR)).body, own)
  assert.equal((await pending(mine, OTHER.floor)).status, 403)
  assert.equal((await pending(manager, 99)).status, 400)
  assert.equal((await pending(manager, FLOOR, 'nope')).status, 400)
  assert.equal((await pending(new ApiClient(baseUrl), FLOOR)).status, 401)
})

test('albumin «Not indicated»: not sent to Google, not an alert, not a follow-up item — and listed under «Not indicated» on the albumin follow-up', async () => {
  const today = new Date().toISOString().slice(0, 10)
  const pharmacist = await loginAs({ role: 'user', floor: FLOOR })
  const manager = await loginAs({ role: 'admin' })
  const indicated = (await form(pharmacist, { kind: 'albumin', date: today, name: 'مستطبّة', patientId: '1', fields: { sex: 'أنثى', age: '30', count: '2', doctor: 'د. سعد' } })).body.request
  await pharmacist.patch(`/api/drug-requests/${indicated.id}/ticks`, { ticks: ['i4'] })
  const not = (await form(pharmacist, { kind: 'albumin', date: today, name: 'غير مستطبّة', patientId: '2', fields: { indicated: 'Not indicated', reason: 'Albumin > 2.5 g/dl', serumAlbumin: '3.1' } })).body.request
  assert.deepEqual([not.fields.indicated, not.fields.reason], ['Not indicated', 'Albumin > 2.5 g/dl'])

  // Not sent (nothing to send), and not counted anywhere as pending: the ward's counts, the floor alert, the dashboard, the admin list.
  const refused = await pharmacist.post(`/api/drug-requests/${not.id}/google-form`, {})
  assert.equal(refused.status, 422)
  assert.match(refused.body.message, /غير مستطبّة/)
  const counts = (await pharmacist.get(`/api/drug-requests/counts?floor=${FLOOR}&ward=${encodeURIComponent(WARD)}&date=${today}`)).body
  assert.deepEqual([counts.albumin, counts.attention.albumin], [2, 1]) // both are forms; only the indicated one (unsent) needs following up
  assert.deepEqual((await pharmacist.get(`/api/dashboard?date=${today}`)).body.formsPending, { total: 1, wards: [{ floor: FLOOR, ward: WARD, n: 1 }] })
  assert.equal((await manager.get(`/api/dashboard?date=${today}`)).body.formsToSend, 1)
  assert.deepEqual((await manager.get(`/api/drug-requests/followup?from=${today}&to=${today}`)).body.rows.map((row) => row.name), ['مستطبّة'])
  assert.deepEqual([needsFollowUp('albumin', { ...not, fields: not.fields }), formProblems('albumin', not)], [false, []])

  // The albumin follow-up: the indicated form is a main row, the other leads the «Not indicated» list.
  const sheet = (await pharmacist.get(`/api/albumin-followup?date=${today}&floor=${FLOOR}`)).body
  assert.deepEqual([sheet.rows.map((row) => row.name), sheet.notForms.map((row) => [row.name, row.fields.reason])], [['مستطبّة'], [['غير مستطبّة', 'Albumin > 2.5 g/dl']]])
  // Flipped back to indicated, it is a main row again and an unsent form again.
  await pharmacist.put(`/api/drug-requests/${not.id}`, { name: 'غير مستطبّة', patientId: '2', fields: { ...not.fields, indicated: 'Indicated' } })
  assert.equal((await pharmacist.get(`/api/albumin-followup?date=${today}&floor=${FLOOR}`)).body.notForms.length, 0)
})
