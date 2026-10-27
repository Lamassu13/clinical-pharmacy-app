// Chart change history: what each accepted save changed, diffed against the rows the save
// replaces (PUT /api/chart reads them back from its own DELETE ... RETURNING, so this costs no
// extra round-trip). Patients are matched by patient ID (else name), not by row number — deleting
// a patient pulls every row below it up one, and a row-by-row diff would log all of them as edits.

const KEEP_DAYS = 90
const PRUNE_EVERY_MS = 24 * 3600 * 1000
let lastPrune = 0 // per process; a deploy restart simply prunes once more
const MAX_STORED = 3000 // a whole-grid wipe is ~2000 cells; anything bigger is not a real edit
const nameKey = (name) => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ')

// Key rows by ID, else name, else (blank rows holding doses) their row number. A repeated key
// gets a counter so two same-named patients do not collapse into one.
const keyRows = (rows) => {
  const seen = new Map()
  return rows.map((row) => {
    const base = row.patientId ? `id:${row.patientId}` : nameKey(row.name) ? `name:${nameKey(row.name)}` : `row:${row.rowNumber}`
    const count = seen.get(base) || 0
    seen.set(base, count + 1)
    return { ...row, key: `${base}#${count}` }
  })
}
const byRow = (cells) => {
  const map = new Map()
  for (const cell of cells) {
    if (!map.has(cell.rowNumber)) map.set(cell.rowNumber, new Map())
    map.get(cell.rowNumber).set(cell.columnNumber, cell.quantity)
  }
  return map
}
const hasContent = (state) => state.patients.some((p) => nameKey(p.name) || p.patientId) || state.columns.length > 0 || state.quantities.some((q) => q.quantity > 0)

// old/new: { patients: [{rowNumber, name, patientId}], columns: [{columnNumber, medicineId, customName}],
// quantities: [{rowNumber, columnNumber, quantity}] }. Returns changes whose medicine is still an
// id/custom reference (`medicineRef`) — recordChartChanges turns those into names in one lookup.
export const diffChart = (oldState, newState) => {
  if (!hasContent(oldState)) {
    if (!hasContent(newState)) return []
    const patients = newState.patients.filter((p) => nameKey(p.name) || p.patientId).length
    const doses = newState.quantities.filter((q) => q.quantity > 0).length
    return [{ kind: 'created', to: `${patients} مريض، ${doses} جرعة` }]
  }
  const changes = []
  const colRef = (state, columnNumber) => state.columns.find((c) => c.columnNumber === columnNumber)
  // Columns: compare the medicine itself (id / preserved custom name), never the displayed text.
  const columnIds = new Set([...oldState.columns, ...newState.columns].map((c) => c.columnNumber))
  for (const columnNumber of [...columnIds].sort((a, b) => a - b)) {
    const before = colRef(oldState, columnNumber)
    const after = colRef(newState, columnNumber)
    const sig = (c) => (c ? `${c.medicineId ?? ''}|${c.customName ?? ''}` : '')
    if (sig(before) !== sig(after)) changes.push({ kind: 'medicine', column: columnNumber, fromRef: before, toRef: after })
  }
  const oldRows = keyRows(oldState.patients.filter((p) => nameKey(p.name) || p.patientId || oldState.quantities.some((q) => q.rowNumber === p.rowNumber && q.quantity > 0)))
  const newRows = keyRows(newState.patients.filter((p) => nameKey(p.name) || p.patientId || newState.quantities.some((q) => q.rowNumber === p.rowNumber && q.quantity > 0)))
  const oldByKey = new Map(oldRows.map((row) => [row.key, row]))
  const newKeys = new Set(newRows.map((row) => row.key))
  const oldQty = byRow(oldState.quantities)
  const newQty = byRow(newState.quantities)
  const cells = (before, after, row, patient) => {
    const a = before ?? new Map()
    const b = after ?? new Map()
    for (const column of [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => x - y)) {
      const from = a.get(column) || 0
      const to = b.get(column) || 0
      if (from !== to) changes.push({ kind: 'qty', row, column, patient, from: from || '', to: to || '' })
    }
  }
  // A row whose key did not match (an ID just added, a typo fixed in a name with no ID) is still
  // the same patient if the old row at that same row number is also unmatched — otherwise the
  // autosave of every typed digit would log "removed" + "added" with all doses.
  const matched = new Set()
  const oldFor = (row) => {
    const byKey = oldByKey.get(row.key)
    if (byKey) return byKey
    return oldRows.find((old) => old.rowNumber === row.rowNumber && !newKeys.has(old.key) && !matched.has(old.key))
  }
  for (const row of newRows) {
    const before = oldFor(row)
    if (!before) {
      changes.push({ kind: 'patient', row: row.rowNumber, from: '', to: row.name || row.patientId })
      cells(null, newQty.get(row.rowNumber), row.rowNumber, row.name)
      continue
    }
    matched.add(before.key)
    if (before.name !== row.name) changes.push({ kind: 'patient', row: row.rowNumber, from: before.name, to: row.name })
    if ((before.patientId || '') !== (row.patientId || '')) changes.push({ kind: 'patient_id', row: row.rowNumber, patient: row.name, from: before.patientId || '', to: row.patientId || '' })
    cells(oldQty.get(before.rowNumber), newQty.get(row.rowNumber), row.rowNumber, row.name)
  }
  for (const row of oldRows) {
    if (newKeys.has(row.key) || matched.has(row.key)) continue
    changes.push({ kind: 'patient', row: row.rowNumber, from: row.name || row.patientId, to: '' })
    cells(oldQty.get(row.rowNumber), null, row.rowNumber, row.name)
  }
  return changes
}

// Piggybacks on a save that wrote history — no timer, so an idle API never wakes Neon.
// ponytail: no index on `at`, so this scans the (≤ 90 days of) table once a day; add one if it grows.
export const pruneChartChanges = (executor) => executor.query(`DELETE FROM chart_changes WHERE at < NOW() - INTERVAL '${KEEP_DAYS} days'`)

// Runs inside PUT /chart's transaction, after the save itself. Never throws into the caller's
// save: a history failure rolls back to the savepoint and is logged, the chart still saves.
export const recordChartChanges = async (client, { chartId, version, user, oldState, newState }) => {
  try {
    await client.query('SAVEPOINT chart_history')
    const changes = diffChart(oldState, newState).slice(0, MAX_STORED)
    if (changes.length) {
      const ids = new Set()
      for (const change of changes) for (const ref of [change.fromRef, change.toRef]) if (ref?.medicineId) ids.add(String(ref.medicineId))
      for (const column of [...oldState.columns, ...newState.columns]) if (column.medicineId) ids.add(String(column.medicineId))
      const names = new Map((await client.query('SELECT id, name FROM medicines WHERE id = ANY($1::bigint[])', [[...ids]])).rows.map((row) => [String(row.id), row.name]))
      const nameOf = (ref) => (ref ? (ref.medicineId ? names.get(String(ref.medicineId)) : ref.customName) || '' : '')
      const columnName = (columnNumber) => nameOf(newState.columns.find((c) => c.columnNumber === columnNumber) || oldState.columns.find((c) => c.columnNumber === columnNumber))
      const column = (pick) => changes.map(pick)
      await client.query(
        `INSERT INTO chart_changes (chart_id, version, user_name, kind, row_number, column_number, patient, medicine, old_value, new_value)
         SELECT $1, $2, $3, kind, rn, cn, patient, medicine, old_value, new_value
         FROM UNNEST($4::text[], $5::int[], $6::int[], $7::text[], $8::text[], $9::text[], $10::text[]) AS u(kind, rn, cn, patient, medicine, old_value, new_value)`,
        [chartId, version, user.fullName || '',
          column((c) => c.kind), column((c) => c.row ?? null), column((c) => c.column ?? null),
          column((c) => c.patient || ''), column((c) => (c.kind === 'medicine' ? '' : c.column ? columnName(c.column) : '')),
          column((c) => (c.kind === 'medicine' ? nameOf(c.fromRef) : String(c.from ?? ''))),
          column((c) => (c.kind === 'medicine' ? nameOf(c.toRef) : String(c.to ?? '')))],
      )
      if (Date.now() - lastPrune > PRUNE_EVERY_MS) { await pruneChartChanges(client); lastPrune = Date.now() }
    }
    await client.query('RELEASE SAVEPOINT chart_history')
  } catch (error) {
    console.error('chart history failed (the save itself is kept):', error)
    // Deliberately not caught: if even this fails the transaction is aborted, and the outer catch
    // must answer 400 — a COMMIT on an aborted transaction is a silent ROLLBACK reported as OK.
    await client.query('ROLLBACK TO SAVEPOINT chart_history')
  }
}
