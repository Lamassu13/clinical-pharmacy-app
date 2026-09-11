import express from 'express'
import multer from 'multer'
import { query } from '../db.js'
import { requireAuth, requireManager } from '../auth.js'
import { cleanText, clampInt } from '../validation.js'

const router = express.Router()

// Memory storage: the buffer goes straight into the BYTEA insert. No temp files — the free
// Render web service has no persistent disk to put them on anyway.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } })

const PDF_MAGIC = Buffer.from('%PDF')
// A client can lie about the mimetype (or just rename a file); the magic bytes are what a
// PDF actually starts with, so check both.
const isPdf = (file) => Boolean(file) && file.mimetype === 'application/pdf' && file.buffer.subarray(0, 4).equals(PDF_MAGIC)

router.get('/treatment-forms', requireAuth, async (_request, response) => {
  const result = await query('SELECT id, title, file_name, file_size, uploaded_at FROM treatment_forms ORDER BY title')
  response.json({
    forms: result.rows.map((row) => ({ id: row.id, title: row.title, fileName: row.file_name, fileSize: row.file_size, uploadedAt: row.uploaded_at })),
  })
})

router.get('/treatment-forms/:id/file', requireAuth, async (request, response) => {
  const id = clampInt(request.params.id, 1, Number.MAX_SAFE_INTEGER)
  if (id === null) return response.status(404).json({ message: 'الاستمارة غير موجودة' })
  const result = await query('SELECT file_name, file_data FROM treatment_forms WHERE id = $1', [id])
  const row = result.rows[0]
  if (!row) return response.status(404).json({ message: 'الاستمارة غير موجودة' })
  response.set('Content-Type', 'application/pdf')
  response.set('Content-Disposition', `attachment; filename="${encodeURIComponent(row.file_name)}"`)
  response.send(row.file_data)
})

router.post('/treatment-forms', requireManager, upload.single('file'), async (request, response) => {
  const title = cleanText(request.body.title, 200).trim()
  if (!title) return response.status(400).json({ message: 'عنوان الاستمارة مطلوب' })
  if (!isPdf(request.file)) return response.status(400).json({ message: 'الملف يجب أن يكون PDF صالحًا' })
  const result = await query(
    'INSERT INTO treatment_forms (title, file_name, file_size, file_data, uploaded_by) VALUES ($1, $2, $3, $4, $5) RETURNING id, title, file_name, file_size, uploaded_at',
    [title, request.file.originalname.slice(0, 200), request.file.size, request.file.buffer, request.session.user.id],
  )
  const row = result.rows[0]
  response.status(201).json({ form: { id: row.id, title: row.title, fileName: row.file_name, fileSize: row.file_size, uploadedAt: row.uploaded_at } })
})

router.put('/treatment-forms/:id', requireManager, upload.single('file'), async (request, response) => {
  const id = clampInt(request.params.id, 1, Number.MAX_SAFE_INTEGER)
  if (id === null) return response.status(404).json({ message: 'الاستمارة غير موجودة' })
  const title = cleanText(request.body.title, 200).trim()
  if (!title) return response.status(400).json({ message: 'عنوان الاستمارة مطلوب' })
  let result
  if (request.file) {
    if (!isPdf(request.file)) return response.status(400).json({ message: 'الملف يجب أن يكون PDF صالحًا' })
    result = await query(
      'UPDATE treatment_forms SET title = $1, file_name = $2, file_size = $3, file_data = $4 WHERE id = $5 RETURNING id, title, file_name, file_size, uploaded_at',
      [title, request.file.originalname.slice(0, 200), request.file.size, request.file.buffer, id],
    )
  } else {
    result = await query('UPDATE treatment_forms SET title = $1 WHERE id = $2 RETURNING id, title, file_name, file_size, uploaded_at', [title, id])
  }
  const row = result.rows[0]
  if (!row) return response.status(404).json({ message: 'الاستمارة غير موجودة' })
  response.json({ form: { id: row.id, title: row.title, fileName: row.file_name, fileSize: row.file_size, uploadedAt: row.uploaded_at } })
})

router.delete('/treatment-forms/:id', requireManager, async (request, response) => {
  const id = clampInt(request.params.id, 1, Number.MAX_SAFE_INTEGER)
  if (id === null) return response.status(404).json({ message: 'الاستمارة غير موجودة' })
  const result = await query('DELETE FROM treatment_forms WHERE id = $1 RETURNING id', [id])
  if (!result.rows[0]) return response.status(404).json({ message: 'الاستمارة غير موجودة' })
  response.json({ ok: true })
})

// A file over the 20MB cap throws before the route handler runs — Express 5 forwards a
// thrown/rejected error from router-level middleware to the next error handler automatically,
// so this only needs to catch Multer's own error shape and answer with a normal JSON 400
// instead of the framework's default HTML error page.
router.use((error, _request, response, next) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === 'LIMIT_FILE_SIZE' ? 'الملف أكبر من الحد المسموح (٢٠ ميغابايت)' : 'تعذر رفع الملف'
    return response.status(400).json({ message })
  }
  next(error)
})

export default router
