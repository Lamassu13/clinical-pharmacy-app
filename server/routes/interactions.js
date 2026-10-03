import express from 'express'
import { query } from '../db.js'
import { requireAuth } from '../auth.js'
import { cleanText } from '../validation.js'
import { genericName } from '../generic-names.js'
import { duplicatePairs } from '../therapy-classes.js'
import { RENAL_DOSES } from '../renal-doses.js'

const router = express.Router()

const MAX_NAMES = 120

// «التداخلات الدوائية»: which of the given catalogue medicines interact with each other, from the
// drug_interactions reference table (loaded by server/import-ddinter.js). Read-only — nothing
// about the chart or its patients is stored. The client sends every medicine name on a ward's
// chart once; the answer is each interacting pair of those names with its DDInter level, and
// each duplicate-therapy pair (two drugs of one class, ../therapy-classes.js).
router.get('/interactions', requireAuth, async (request, response) => {
  const raw = [].concat(request.query.name ?? [])
  const names = [...new Set(raw.map((value) => cleanText(value, 200).trim()).filter(Boolean))].slice(0, MAX_NAMES)
  const namesByGeneric = new Map()
  names.forEach((name) => {
    const generic = genericName(name)
    if (generic) namesByGeneric.set(generic, [...(namesByGeneric.get(generic) || []), name])
  })
  const generics = [...namesByGeneric.keys()]
  if (generics.length < 2) return response.json({ pairs: [], duplicates: [] })
  const result = await query('SELECT drug_a, drug_b, level FROM drug_interactions WHERE drug_a = ANY($1::text[]) AND drug_b = ANY($1::text[])', [generics])
  const pairs = result.rows.flatMap((row) => namesByGeneric.get(row.drug_a).flatMap((a) => namesByGeneric.get(row.drug_b).map((b) => ({ a, b, level: row.level }))))
  response.json({ pairs, duplicates: duplicatePairs(names, genericName) })
})

// «تعديل الجرعة الكلوية»: the renal dose rules (../renal-doses.js) for the given medicine names,
// keyed by name. Only names go out; the patient's creatinine and CrCl stay in the browser.
router.get('/renal-doses', requireAuth, (request, response) => {
  const names = [...new Set([].concat(request.query.name ?? []).map((value) => cleanText(value, 200).trim()).filter(Boolean))].slice(0, MAX_NAMES)
  const rules = {}
  names.forEach((name) => {
    const generic = genericName(name)
    if (RENAL_DOSES[generic]) rules[name] = { generic, ...RENAL_DOSES[generic] }
  })
  response.json({ rules })
})

export default router
