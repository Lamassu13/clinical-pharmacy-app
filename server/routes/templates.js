import express from 'express'
import { query } from '../db.js'
import { requireAuth } from '../auth.js'
import { cleanText, MAX_CHART_COLUMNS, normalizeMedicineKey, medicineKeySql } from '../validation.js'

const router = express.Router()

// «قوالب الأدوية» — personal: every route reads and writes only the signed-in user's rows.
const toTemplate = (row) => ({ id: Number(row.id), name: row.name, medicines: row.medicines })

router.get('/templates', requireAuth, async (request, response) => {
  const result = await query('SELECT id, name, medicines FROM medicine_templates WHERE user_id = $1 ORDER BY name', [request.session.user.id])
  response.json({ templates: result.rows.map(toTemplate) })
})

// Saving under an existing name replaces that template (the client confirms first).
router.post('/templates', requireAuth, async (request, response) => {
  const name = cleanText(request.body.name, 60).trim()
  if (!name) return response.status(400).json({ message: 'اسم القالب مطلوب' })
  const requested = (Array.isArray(request.body.medicines) ? request.body.medicines : [])
    .slice(0, MAX_CHART_COLUMNS)
    .map((value) => cleanText(value, 200).trim())
  // A chart column may only hold a catalogue medicine, so a template may too: snap each name to
  // its catalogue spelling and keep the first of any duplicate. Empty columns stay where they
  // were (so does a name no longer in the catalogue, as an empty column) — the layout is saved as is.
  const keys = [...new Set(requested.filter(Boolean).map(normalizeMedicineKey))]
  const found = keys.length
    ? await query(`SELECT name, ${medicineKeySql('name')} AS key FROM medicines WHERE ${medicineKeySql('name')} = ANY($1::text[])`, [keys])
    : { rows: [] }
  const nameByKey = new Map(found.rows.map((row) => [row.key, row.name]))
  const used = new Set()
  const medicines = requested.map((value) => {
    const name = value && nameByKey.get(normalizeMedicineKey(value))
    if (!name || used.has(name)) return ''
    used.add(name)
    return name
  })
  while (medicines.length && !medicines[medicines.length - 1]) medicines.pop() // trailing blanks are only padding
  if (!used.size) return response.status(400).json({ message: 'لا توجد أدوية من القائمة في هذا الجارت لحفظها' })
  const result = await query(
    `INSERT INTO medicine_templates (user_id, name, medicines) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, name) DO UPDATE SET medicines = EXCLUDED.medicines, updated_at = NOW()
     RETURNING id, name, medicines`,
    [request.session.user.id, name, medicines],
  )
  response.json({ template: toTemplate(result.rows[0]) })
})

router.delete('/templates/:id', requireAuth, async (request, response) => {
  const id = Number(request.params.id)
  if (!Number.isInteger(id) || id < 1) return response.status(400).json({ message: 'معرّف غير صحيح' })
  const result = await query('DELETE FROM medicine_templates WHERE id = $1 AND user_id = $2', [id, request.session.user.id])
  if (!result.rowCount) return response.status(404).json({ message: 'القالب غير موجود' })
  response.json({ ok: true })
})

export default router
