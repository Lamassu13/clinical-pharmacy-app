// Pure helpers with no React and no I/O, so they can be read — and reasoned about — without
// the component around them.
import { floors, specialWards, PATIENT_ROWS, CHART_COLUMNS } from './constants.js'

// Shared by the two places a chart snapshot from elsewhere (the server, after a save
// conflict; or localStorage, after a killed tab) has to be combined with what is on screen:
// field by field, a value that differs from `base` (the last state this tab knows the
// server actually has) is an edit made here and wins; everything else adopts `fresh`.
export const mergeChartSnapshots = (base, current, fresh) => ({
  patientNames: fresh.patientNames.map((value, index) => (current.patientNames[index] !== base.patientNames[index] ? current.patientNames[index] : value)),
  columnMedicines: fresh.columnMedicines.map((value, index) => (current.columnMedicines[index] !== base.columnMedicines[index] ? current.columnMedicines[index] : value)),
  quantities: fresh.quantities.map((row, rowIndex) => row.map((value, columnIndex) => (current.quantities[rowIndex][columnIndex] !== base.quantities[rowIndex]?.[columnIndex] ? current.quantities[rowIndex][columnIndex] : value))),
})

// Reports what a merge (mergeChartSnapshots above) actually did, relative to `mine` (this
// tab's pre-merge state) and `fresh` (the other side's state) — so neither call site can
// silently drop a real edit without telling the pharmacist. `adopted` lists fields fresh won
// (this tab's own value was replaced). `dropped` keys quantity cells where mine won over a
// differing, genuinely non-empty fresh value, shown on the grid as "كان: X" until resolved.
// `droppedOther` counts the same silent-win case for patient names / medicine names, which
// have no per-cell tag of their own — folded into the clash-note text instead of dropped on
// the floor. A blank fresh value is never counted as "dropped": that's simply a field the
// server never had data for yet (a brand-new edit landing during a conflict retry, not a
// second writer's value being discarded), so flagging it would just be noise on top of an
// otherwise-uneventful save.
export const diffMergeOutcome = (merged, mine, fresh) => {
  const adopted = []
  let droppedOther = 0
  merged.patientNames.forEach((value, row) => {
    const mineValue = mine.patientNames[row] ?? ''
    const freshValue = fresh.patientNames[row] ?? ''
    if (value !== mineValue) adopted.push(`اسم المريض صف ${row + 1}`)
    else if (freshValue !== mineValue && freshValue !== '') droppedOther += 1
  })
  merged.columnMedicines.forEach((value, col) => {
    const mineValue = mine.columnMedicines[col] ?? ''
    const freshValue = fresh.columnMedicines[col] ?? ''
    if (value !== mineValue) adopted.push(`دواء عمود ${col + 1}`)
    else if (freshValue !== mineValue && freshValue !== '') droppedOther += 1
  })
  const dropped = {}
  merged.quantities.forEach((cells, row) => cells.forEach((value, col) => {
    const mineValue = mine.quantities[row]?.[col] ?? ''
    const freshValue = fresh.quantities[row]?.[col] ?? ''
    if (value !== mineValue) {
      const who = merged.patientNames[row]?.trim() || `صف ${row + 1}`
      const drug = merged.columnMedicines[col]?.trim() || `عمود ${col + 1}`
      adopted.push(`${who} — ${drug}`)
    } else if (freshValue !== mineValue && freshValue !== '') {
      dropped[`${row}:${col}`] = freshValue
    }
  }))
  return { adopted, dropped, droppedOther }
}

// Same three-way merge as mergeChartSnapshots, generalized to any flat string-keyed map —
// pills' entries (`"row:medicineKey"` -> {...}) and rooms (`"row"` -> roomNumber) are both this
// shape, one merge unit per key rather than per grid cell (a pill entry's fields are always
// edited together, so there's no finer level worth splitting).
export const mergeKeyedSnapshots = (base, current, fresh) => {
  const keys = new Set([...Object.keys(base || {}), ...Object.keys(current || {}), ...Object.keys(fresh || {})])
  const merged = {}
  keys.forEach((key) => {
    const changedHere = JSON.stringify(current?.[key] ?? null) !== JSON.stringify(base?.[key] ?? null)
    const value = changedHere ? current?.[key] : fresh?.[key]
    if (value !== undefined) merged[key] = value
  })
  return merged
}

// Counts-only sibling of diffMergeOutcome for a mergeKeyedSnapshots result — pill forms are
// short enough that a per-field breakdown (chart's "كان" tags) isn't worth the extra UI; a
// pharmacist reviewing "N حقلًا حُدّث" already knows to re-check the form.
export const diffKeyedMergeOutcome = (merged, mine, fresh) => {
  const keys = new Set([...Object.keys(merged || {}), ...Object.keys(mine || {}), ...Object.keys(fresh || {})])
  let adopted = 0
  let dropped = 0
  keys.forEach((key) => {
    const mergedValue = JSON.stringify(merged?.[key] ?? null)
    const mineValue = JSON.stringify(mine?.[key] ?? null)
    const freshValue = JSON.stringify(fresh?.[key] ?? null)
    if (mergedValue !== mineValue) adopted += 1
    else if (freshValue !== mineValue && fresh?.[key] !== undefined) dropped += 1
  })
  return { adopted, dropped }
}

// استمارة الحبوب الإضافي always has exactly 7 medicine slots (server/routes/extra-pills.js'
// own SLOTS) — the shape a brand-new form starts with, both for the optimistic card shown the
// instant "+ إنشاء استمارة جديدة" is clicked offline and for applyExtraPillsQueue's own fallback
// below when that create is recovered from a reload before it was ever filled in (patch: null).
// One shared shape so those two call sites can't quietly drift apart.
export const EXTRA_PILL_SLOTS = 7
export const blankExtraPillForm = (floorValue, ward) => ({
  floor: floorValue, ward, patientName: '', roomNumber: '',
  entries: Array.from({ length: EXTRA_PILL_SLOTS }, (_, i) => ({ slot: i + 1, medicineName: '', pillQty: '', doseTime: '', usageMethod: '', note: '' })),
})

// Upserts a locally queued استمارة الحبوب الإضافي write by key: a repeated offline edit to the
// same not-yet-synced form replaces the pending payload instead of piling up redundant ops —
// the same "latest write wins" policy chart/pills already use for their own autosave. Deleting
// a form whose 'create' never reached the server just cancels that create — there's nothing to
// delete yet.
export const enqueueExtraPillsOp = (queue, entry) => {
  if (entry.op === 'delete' && queue.some((item) => item.key === entry.key && item.op === 'create')) {
    return queue.filter((item) => item.key !== entry.key)
  }
  return [...queue.filter((item) => item.key !== entry.key), entry]
}

// Projects the server's extra-pill forms plus locally queued, not-yet-synced changes into what
// the screen should show — a queued create/edit/delete is visible (and survives a reload)
// before it ever reaches the server. Applied in queue order, oldest first.
export const applyExtraPillsQueue = (forms, queue) => {
  const byKey = new Map(forms.map((form) => [String(form.id), form]))
  const order = forms.map((form) => String(form.id))
  queue.forEach((entry) => {
    if (entry.op === 'create') { byKey.set(entry.key, { ...blankExtraPillForm(entry.floor, entry.ward), ...(entry.patch || {}), id: entry.key, pending: true }); order.push(entry.key) }
    else if (entry.op === 'update') { const existing = byKey.get(entry.key); if (existing) byKey.set(entry.key, { ...existing, ...entry.patch, pending: true }) }
    else if (entry.op === 'delete') { byKey.delete(entry.key); const i = order.indexOf(entry.key); if (i !== -1) order.splice(i, 1) }
  })
  return order.map((key) => byKey.get(key)).filter(Boolean)
}

// GET /api/chart's row-per-cell shape, expanded to the grid the UI keeps in state — at least
// CHART_COLUMNS wide, wider if a manual "+ عمود" (src/App.jsx addColumn) previously grew this
// particular chart past that and it was saved, so reopening it shows every column it actually
// has rather than truncating back to the default width.
export const parseChartRows = (chart) => {
  const columnCount = chart ? Math.max(CHART_COLUMNS, ...chart.columns.map((c) => c.column_number), ...chart.quantities.map((q) => q.column_number)) : CHART_COLUMNS
  const patientNames = Array(PATIENT_ROWS).fill('')
  const quantities = Array.from({ length: PATIENT_ROWS }, () => Array(columnCount).fill(''))
  const columnMedicines = Array(columnCount).fill('')
  if (chart) {
    chart.patients.forEach((patient) => { patientNames[patient.row_number - 1] = patient.patient_name })
    chart.quantities.forEach((quantity) => { quantities[quantity.row_number - 1][quantity.column_number - 1] = String(quantity.quantity) })
    chart.columns.forEach((column) => { columnMedicines[column.column_number - 1] = column.medicine_name || '' })
  }
  return { patientNames, columnMedicines, quantities }
}

export const toEnglishDigits = (value) => value.replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
// Three supplies carry a quantity the pharmacist should not have to type. They are matched by
// pattern rather than by exact name: none of them is in the catalogue yet, so whatever spelling
// gets added later — Arabic or Latin, any case, any spacing, Arabic-Indic or Latin digits —
// still has to be recognised. toEnglishDigits runs first so "سرنجة ٥ سيسي" and "syringe 5cc"
// normalise the same way.
export const medicineKey = (value) => toEnglishDigits(String(value ?? '')).trim().replace(/\s+/g, ' ').toLowerCase()

// Deliberately not medicineKey: a wrong-patient match here copies real doses onto the wrong
// row, so only whitespace noise is absorbed — case/spelling differences count as different
// patients on purpose.
export const patientNameKey = (value) => String(value ?? '').trim().replace(/\s+/g, ' ')

// Levenshtein distance, single-row iterative (older iPadOS Safari safe).
const editDistance = (a, b) => {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]
      row[j] = a[i - 1] === b[j - 1] ? prev : Math.min(prev, row[j], row[j - 1]) + 1
      prev = cur
    }
  }
  return row[b.length]
}
// The one catalogue name that is a near-miss of `query`, or '' when zero or several qualify —
// guessing between two real drug names is worse than offering nothing on a medication field.
export const nearestMedicine = (query, catalogue) => {
  const q = medicineKey(query)
  if (q.length < 3) return ''
  const limit = Math.min(3, Math.floor(q.length / 4) + 1)
  const hits = catalogue.filter((name) => editDistance(q, medicineKey(name)) <= limit)
  return hits.length === 1 ? hits[0] : ''
}
// One per patient on the ward: a giving set and a cannula each get used once.
export const UNIT_ONE = /\biv\s*-?\s*set\b|كانيول|cannula|canula/
// The 5cc syringe. The digit is required: without it "Clexane prefilled syringe 4000 IU",
// which is already in the catalogue, would be mistaken for it.
const SYRINGE_NAME = /سرنج|syringe/
// A 5 that is not part of a longer number, so "5cc" and "٥ سيسي" match while "4000" and
// "500" do not. Written without lookbehind, which older iPadOS Safari does not support.
const SYRINGE_SIZE = /(^|\D)5(\D|$)/
export const isSyringe = (name) => { const key = medicineKey(name); return SYRINGE_NAME.test(key) && SYRINGE_SIZE.test(key) }
// What a syringe is drawn from. Word boundaries, like PILL_FORM on the server, so that
// "Ampicillin" is not read as an ampoule.
export const VIAL_AMP = /\b(vial|vials|amp|amps|ampoule|ampoules)\b/
// Vial/amp medicines that are hung ready-mixed, not drawn up — so they never feed a
// Syringe 5cc column's auto-total even though they match VIAL_AMP.
export const SYRINGE_EXCLUDE = /flagyl|paracetamol|فلاجيل|باراسيتامول/

export const isoDate = (value) => {
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// Ward-attention data, shared by the floor/ward hub and the manager dashboard: started counts
// at ward granularity, plus one ranked list of wards needing a nudge — never-started first,
// then started-but-stalled (idle QUIET_AFTER_MIN+ minutes). Every entry names the ward its row
// opens, so a caller with a chart-opening handler can jump straight to it.
const QUIET_AFTER_MIN = 15
export const wardAttention = (floors, specialWards, dashboard) => {
  const startedKeys = new Set((dashboard?.startedWards ?? []).map((item) => `${item.floor ?? 'x'}|${item.ward}`))
  const floorStarted = (floor) => floor.wards.filter((ward) => startedKeys.has(`${floor.number}|${ward}`)).length
  const startedSpecialWards = new Set(specialWards.filter((ward) => startedKeys.has(`x|${ward}`)))
  const totalCount = floors.reduce((sum, floor) => sum + floor.wards.length, 0) + specialWards.length
  const startedCount = floors.reduce((sum, floor) => sum + floorStarted(floor), 0) + startedSpecialWards.size
  const notStarted = [
    ...floors.flatMap((floor) => floor.wards
      .filter((ward) => !startedKeys.has(`${floor.number}|${ward}`))
      .map((ward) => ({ key: `p|${floor.number}|${ward}`, kind: 'pending', floorNumber: floor.number, ward, slot: 'main', name: `الطابق ${floor.number} — ${ward}` }))),
    ...specialWards
      .filter((ward) => !startedSpecialWards.has(ward))
      .map((ward) => ({ key: `p|x|${ward}`, kind: 'pending', floorNumber: null, ward, slot: 'main', name: ward })),
  ]
  const stalled = (dashboard?.startedWards ?? [])
    .filter((item) => (item.minutesQuiet ?? 0) >= QUIET_AFTER_MIN)
    .sort((a, b) => (b.minutesQuiet ?? 0) - (a.minutesQuiet ?? 0))
    .map((item) => ({
      key: `s|${item.floor ?? 'x'}|${item.ward}|${item.slot || 'main'}`,
      kind: 'stopped',
      floorNumber: item.floor ?? null,
      ward: item.ward,
      slot: item.slot || 'main',
      name: `${item.floor ? `الطابق ${item.floor} — ${item.ward}` : item.ward}${item.slot === 'extra' ? ' — إضافي' : ''}`,
      updatedAt: item.updatedAt,
    }))
  return { startedCount, totalCount, floorStarted, startedSpecialWards, attention: [...notStarted, ...stalled] }
}

export const locationBody = (value) => {
  const asFloor = Number(value)
  if (floors.some((item) => item.number === asFloor)) return { floor: asFloor }
  if (specialWards.includes(value)) return { ward: value }
  return null
}

// Pill entries are held as { "<row>:<medicine key>": {...} }. The medicine key is a name, so
// split on the first colon only rather than on every one.
export const pillEntryList = (entries) => Object.entries(entries).map(([key, value]) => {
  const separator = key.indexOf(':')
  return {
    patientRowNumber: Number(key.slice(0, separator)),
    medicineKey: key.slice(separator + 1),
    doseTime: value.doseTime || '', usageMethod: value.usageMethod || '', note: value.note || '',
    pillQty: value.pillQty || '', pillName: value.pillName || '',
  }
})

// A treatment-form's size, for the استمارات العلاج list — "340 كيلوبايت" / "1.2 ميغابايت".
export const formatFileSize = (bytes) => {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n < 0) return ''
  if (n < 1024) return `${n} بايت`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} كيلوبايت`
  return `${(n / (1024 * 1024)).toFixed(1)} ميغابايت`
}
