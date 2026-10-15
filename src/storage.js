// Device storage for drafts, offline copies, offline queues and the session cache: IndexedDB,
// which a browser keeps longer and allows more of than localStorage (old iPads drop localStorage
// under storage pressure, and it is capped at ~5 MB). Call sites stay synchronous: hydrateStorage()
// loads every entry into memory before the app first renders, and each write goes to memory at
// once and to IndexedDB in the background.
//
// Falls back to plain localStorage (the old behaviour) whenever IndexedDB is missing, refuses to
// open (private mode), hangs (an iOS 14 bug), or a write to it fails later on. While on the
// fallback, removals are remembered in REMOVED_KEY so the next IndexedDB boot doesn't bring back
// a draft that was already saved and cleared. cpa-theme stays in localStorage: theme.js reads it
// before any script loads.
const DB_NAME = 'cpa-storage'
const STORE = 'kv'
const REMOVED_KEY = 'cpa-storage-removed'
const LOCAL_ONLY = new Set(['cpa-theme', REMOVED_KEY])
const OPEN_TIMEOUT_MS = 2000

let memory = null // Map while IndexedDB is in use; null = localStorage fallback
let db = null
let hydratedLocal = null
// Read lazily, not at import: before hydrateStorage() (and in node tests) this is whatever
// localStorage the page has.
const local = () => hydratedLocal || globalThis.localStorage

const isMigratable = (key) => Boolean(key) && key.startsWith('cpa-') && !LOCAL_ONLY.has(key)
const localKeys = (ls) => {
  const keys = []
  for (let i = 0; i < ls.length; i += 1) { const key = ls.key(i); if (isMigratable(key)) keys.push(key) }
  return keys
}
const readRemoved = (ls) => { try { return JSON.parse(ls.getItem(REMOVED_KEY) || '[]') } catch { return [] } }

// What the device holds after a boot: IndexedDB's entries, minus what was removed while on the
// localStorage fallback, overridden by what is in localStorage (only ever written while on the
// fallback, so always the newer copy). Pure, for the test.
export const planHydrate = (stored, local, removed) => {
  const entries = new Map(stored)
  for (const key of removed) entries.delete(key)
  for (const [key, value] of local) entries.set(key, value)
  return entries
}

const fallBack = () => {
  // A write failed mid-session (e.g. iOS dropping the IndexedDB connection): keep going on
  // localStorage, copying what memory holds so nothing written this session is lost.
  if (!memory) return
  const entries = memory
  memory = null
  db = null
  for (const [key, value] of entries) { try { local().setItem(key, value) } catch { /* full — as before */ } }
}

const persist = (run) => {
  try {
    const tx = db.transaction(STORE, 'readwrite')
    tx.onerror = fallBack
    tx.onabort = fallBack
    run(tx.objectStore(STORE))
  } catch { fallBack() }
}

export const storage = {
  getItem(key) {
    if (memory) return memory.has(key) ? memory.get(key) : null
    return local().getItem(key)
  },
  setItem(key, value) {
    const text = String(value)
    if (memory) { memory.set(key, text); persist((store) => store.put(text, key)); return }
    const ls = local()
    ls.setItem(key, text)
    const removed = readRemoved(ls)
    if (removed.includes(key)) ls.setItem(REMOVED_KEY, JSON.stringify(removed.filter((item) => item !== key)))
  },
  removeItem(key) {
    if (memory) { memory.delete(key); persist((store) => store.delete(key)); return }
    const ls = local()
    ls.removeItem(key)
    // ponytail: capped at 500 keys; a device that never gets IndexedDB back only ever trims it.
    const removed = readRemoved(ls).filter((item) => item !== key)
    try { ls.setItem(REMOVED_KEY, JSON.stringify([...removed, key].slice(-500))) } catch { /* best effort */ }
  },
  keys() {
    if (memory) return [...memory.keys()]
    return localKeys(local())
  },
}

const openDb = (idb) => new Promise((resolve, reject) => {
  const request = idb.open(DB_NAME, 1)
  request.onupgradeneeded = () => request.result.createObjectStore(STORE)
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
  request.onblocked = () => reject(new Error('blocked'))
})

const readAll = (database) => new Promise((resolve, reject) => {
  const entries = []
  const request = database.transaction(STORE, 'readonly').objectStore(STORE).openCursor()
  request.onsuccess = () => {
    const cursor = request.result
    if (!cursor) { resolve(entries); return }
    entries.push([String(cursor.key), cursor.value])
    cursor.continue()
  }
  request.onerror = () => reject(request.error)
})

// Copy-then-delete: localStorage is only cleared after the IndexedDB transaction has committed,
// so a tab killed mid-migration just migrates again next time.
const writeAll = (database, entries, removed) => new Promise((resolve, reject) => {
  const tx = database.transaction(STORE, 'readwrite')
  const store = tx.objectStore(STORE)
  for (const key of removed) store.delete(key)
  for (const [key, value] of entries) store.put(value, key)
  tx.oncomplete = resolve
  tx.onerror = () => reject(tx.error)
  tx.onabort = () => reject(tx.error)
})

// Never rejects: on any problem the app simply runs on localStorage, as before.
export const hydrateStorage = async ({ idb = globalThis.indexedDB, ls = globalThis.localStorage } = {}) => {
  hydratedLocal = ls
  memory = null
  db = null
  if (!idb || !ls) return 'local'
  let timer
  try {
    const database = await Promise.race([
      openDb(idb),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), OPEN_TIMEOUT_MS) }),
    ])
    const stored = await readAll(database)
    const fromLocal = localKeys(ls).map((key) => [key, ls.getItem(key)])
    const removed = readRemoved(ls)
    if (fromLocal.length || removed.length) {
      await writeAll(database, fromLocal, removed)
      for (const [key] of fromLocal) ls.removeItem(key)
      ls.removeItem(REMOVED_KEY)
    }
    db = database
    database.onclose = fallBack // iOS can drop the connection while the app is in the background
    memory = planHydrate(stored, fromLocal, removed)
    return 'indexeddb'
  } catch {
    return 'local'
  } finally { clearTimeout(timer) }
}

// One offline queue for small last-write-wins writes (ward note, course day, chart complete),
// modelled on the extra-pills queue. An entry is only added after the online request itself
// failed to reach the server. `key` names what is written: a newer entry for the same key (and
// user) replaces the older one. `user` keeps a shared iPad from sending one pharmacist's queued
// change under the next one's session.
const WRITE_QUEUE_KEY = 'cpa-write-queue'
const readWrites = () => { try { return JSON.parse(storage.getItem(WRITE_QUEUE_KEY) || '[]') } catch { return [] } }
const saveWrites = (queue) => {
  try { if (queue.length) storage.setItem(WRITE_QUEUE_KEY, JSON.stringify(queue)); else storage.removeItem(WRITE_QUEUE_KEY) } catch { /* best effort */ }
}
let writeSeq = 0
export const queueWrite = (entry) => {
  writeSeq += 1
  saveWrites([...readWrites().filter((item) => item.key !== entry.key || item.user !== entry.user), { ...entry, id: `${Date.now()}-${writeSeq}` }])
}
// An online save of the same thing succeeded: an older queued copy must not overwrite it later.
export const forgetWrite = (key) => { const queue = readWrites(); if (queue.some((item) => item.key === key)) saveWrites(queue.filter((item) => item.key !== key)) }
export const pendingWrites = (user) => readWrites().filter((item) => item.user === user)

// Sends this user's queued writes in order with `send(entry)` (a fetch Response). A network
// error, 401 (signed out) or 5xx stops the run and keeps the rest; another 4xx means the server
// refused it for good, so it is dropped and returned for the caller to surface.
let flushing = false
export const flushWrites = async (user, send) => {
  if (flushing) return { sent: 0, dropped: [] }
  flushing = true
  try { return await sendWrites(user, send) } finally { flushing = false }
}
const sendWrites = async (user, send) => {
  const sent = []
  const dropped = []
  for (const entry of pendingWrites(user)) {
    let response
    try { response = await send(entry) } catch { break }
    if (response.status === 401 || response.status >= 500) break
    if (response.ok) sent.push(entry.id)
    else { sent.push(entry.id); dropped.push(entry) }
  }
  // Re-read: a write queued while this ran stays (it has a new id, even for the same key).
  if (sent.length) saveWrites(readWrites().filter((item) => !sent.includes(item.id)))
  return { sent: sent.length, dropped }
}
