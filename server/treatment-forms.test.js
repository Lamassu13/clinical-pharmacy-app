import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.js'
import { pool } from './db.js'
import { startServer, resetDatabase, createUser, ApiClient } from './test-helpers.js'

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

const PDF_BYTES = Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF', 'binary')
const pdfForm = ({ title = 'استمارة تجريبية', filename = 'form.pdf', bytes = PDF_BYTES, mime = 'application/pdf', omitFile = false } = {}) => {
  const form = new FormData()
  if (title !== undefined) form.append('title', title)
  if (!omitFile) form.append('file', new Blob([bytes], { type: mime }), filename)
  return form
}

test('treatment forms: auth is required to read; only a manager may write', async () => {
  const anon = new ApiClient(baseUrl)
  assert.equal((await anon.get('/api/treatment-forms')).status, 401)
  // requireManager checks the role directly rather than first checking for a session (like
  // every other requireManager route), so an anonymous write gets 403, not 401.
  assert.equal((await anon.postForm('/api/treatment-forms', pdfForm())).status, 403)

  const member = await loginAs({ role: 'user', floor: 5 })
  assert.equal((await member.get('/api/treatment-forms')).status, 200)
  assert.equal((await member.postForm('/api/treatment-forms', pdfForm())).status, 403)

  const manager = await loginAs({ role: 'supervisor' })
  const created = await manager.postForm('/api/treatment-forms', pdfForm())
  assert.equal(created.status, 201)
  const id = created.body.form.id

  // Raw fetch, not ApiClient.get: the file route answers a PDF body, and ApiClient always
  // JSON.parses the response text.
  const fileResponse = await fetch(`${baseUrl}/api/treatment-forms/${id}/file`, { headers: { cookie: `cpa.sid=${member.cookies.get('cpa.sid')}` } })
  assert.equal(fileResponse.status, 200)
  assert.equal((await member.putForm(`/api/treatment-forms/${id}`, pdfForm())).status, 403)
  assert.equal((await member.delete(`/api/treatment-forms/${id}`)).status, 403)
})

test('POST /api/treatment-forms: rejects a missing title, a missing file, and a non-PDF', async () => {
  const manager = await loginAs({ role: 'admin' })
  assert.equal((await manager.postForm('/api/treatment-forms', pdfForm({ title: '' }))).status, 400)
  assert.equal((await manager.postForm('/api/treatment-forms', pdfForm({ omitFile: true }))).status, 400)
  // Claims to be a PDF (mimetype + .pdf extension) but the bytes are not — magic-byte check catches it.
  assert.equal((await manager.postForm('/api/treatment-forms', pdfForm({ bytes: Buffer.from('not a pdf') }))).status, 400)

  const ok = await manager.postForm('/api/treatment-forms', pdfForm({ title: '  استمارة صالحة  ' }))
  assert.equal(ok.status, 201)
  assert.equal(ok.body.form.title, 'استمارة صالحة', 'title is trimmed')
  assert.equal(ok.body.form.fileData, undefined, 'the response never carries file bytes')
})

test('GET /api/treatment-forms: sorted by title, no file bytes in the list', async () => {
  const manager = await loginAs({ role: 'admin' })
  await manager.postForm('/api/treatment-forms', pdfForm({ title: 'ب - نموذج' }))
  await manager.postForm('/api/treatment-forms', pdfForm({ title: 'أ - نموذج' }))

  const list = await manager.get('/api/treatment-forms')
  assert.equal(list.status, 200)
  assert.deepEqual(list.body.forms.map((f) => f.title), ['أ - نموذج', 'ب - نموذج'])
  assert.ok(list.body.forms.every((f) => f.fileData === undefined && f.file_data === undefined))
})

test('GET /api/treatment-forms/:id/file: returns the exact bytes and headers; 404 when missing', async () => {
  const manager = await loginAs({ role: 'admin' })
  const created = await manager.postForm('/api/treatment-forms', pdfForm({ title: 'ملف', filename: 'مذكرة.pdf' }))
  const id = created.body.form.id

  const response = await fetch(`${baseUrl}/api/treatment-forms/${id}/file`, { headers: { cookie: `cpa.sid=${manager.cookies.get('cpa.sid')}` } })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/pdf')
  assert.match(response.headers.get('content-disposition') || '', /attachment/)
  const bytes = Buffer.from(await response.arrayBuffer())
  assert.ok(bytes.equals(PDF_BYTES))

  assert.equal((await manager.get('/api/treatment-forms/999999/file')).status, 404)
})

test('PUT /api/treatment-forms/:id: title-only leaves the file untouched; a new file replaces it', async () => {
  const manager = await loginAs({ role: 'admin' })
  const created = await manager.postForm('/api/treatment-forms', pdfForm({ title: 'قديم' }))
  const id = created.body.form.id
  const originalSize = created.body.form.fileSize

  const renamed = await manager.putForm(`/api/treatment-forms/${id}`, pdfForm({ title: 'جديد', omitFile: true }))
  assert.equal(renamed.status, 200)
  assert.equal(renamed.body.form.title, 'جديد')
  assert.equal(renamed.body.form.fileSize, originalSize, 'no file sent -> bytes untouched')

  const biggerPdf = Buffer.concat([PDF_BYTES, Buffer.alloc(50, 0x20)])
  const replaced = await manager.putForm(`/api/treatment-forms/${id}`, pdfForm({ title: 'جديد', bytes: biggerPdf, filename: 'v2.pdf' }))
  assert.equal(replaced.status, 200)
  assert.equal(replaced.body.form.fileSize, biggerPdf.length)
  assert.equal(replaced.body.form.fileName, 'v2.pdf')

  assert.equal((await manager.putForm('/api/treatment-forms/999999', pdfForm({ omitFile: true }))).status, 404)
})

test('DELETE /api/treatment-forms/:id: removes the row; a second delete is 404', async () => {
  const manager = await loginAs({ role: 'admin' })
  const created = await manager.postForm('/api/treatment-forms', pdfForm())
  const id = created.body.form.id

  assert.equal((await manager.delete(`/api/treatment-forms/${id}`)).status, 200)
  assert.equal((await manager.get('/api/treatment-forms')).body.forms.length, 0)
  assert.equal((await manager.delete(`/api/treatment-forms/${id}`)).status, 404)
})
