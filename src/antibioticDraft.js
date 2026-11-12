import { storage } from './storage.js'
import { cleanForm } from '../shared/antibiotic-form.js'

// «استمارة صرف المضادات»'s device draft: every edit is kept here (per user, ward and patient) until the
// server has answered a save of it with a 2xx — not merely until the save was queued — so a refused or
// conflicting replay never takes the only copy with it.
const PREFIX = 'cpa-abx-draft:'
const KEEP_MS = 14 * 86400000
export const abxDraftKey = (userId, wardKey, patientKey) => `${PREFIX}${userId}|${wardKey}|${patientKey}`
// The offline queue's key (src/storage.js queueWrite): a newer save of the same form replaces an older one.
export const abxQueueKey = (wardKey, patientKey) => `abx-form:${wardKey}|${patientKey}`
export const readAbxDraft = (key) => { try { return JSON.parse(storage.getItem(key) || 'null') } catch { return null } }
export const writeAbxDraft = (key, draft) => { try { storage.setItem(key, JSON.stringify({ ...draft, savedAt: Date.now() })) } catch { /* storage full — the save itself still goes */ } }
export const dropAbxDraft = (key) => { try { storage.removeItem(key) } catch { /* best effort */ } }
// Two forms compared as the server would store them.
export const sameForm = (a, b) => JSON.stringify(cleanForm(a)) === JSON.stringify(cleanForm(b))
// A queued save reached the server (App's flush loop): its draft goes too, unless it was edited after that save was queued.
export const settleAbxDraft = (entry) => {
  if (!entry.draftKey) return
  const draft = readAbxDraft(entry.draftKey)
  if (draft && sameForm(draft.form, entry.body)) dropAbxDraft(entry.draftKey)
}
// Drafts nobody came back to in two weeks are dropped, like the chart's stale drafts.
export const pruneAbxDrafts = () => {
  try {
    storage.keys().filter((key) => key.startsWith(PREFIX)).forEach((key) => {
      const draft = readAbxDraft(key)
      if (!draft || Date.now() - (draft.savedAt || 0) > KEEP_MS) dropAbxDraft(key)
    })
  } catch { /* storage unavailable */ }
}
