// The last answer of «متابعة الاستمارات» per period, kept for a few minutes so that opening a form from it and coming back
// does not fetch the whole list again (the data moved is what the free plans limit). Anything that changes a form clears it
// (useDrugRequests), and the screen has «تحديث». Memory only: a reload starts empty.
const KEEP_MS = 5 * 60_000
const answers = new Map()
export const readFollowup = (days) => { const hit = answers.get(days); return hit && Date.now() - hit.at < KEEP_MS ? hit : null }
export const keepFollowup = (days, rows, more) => { answers.set(days, { at: Date.now(), rows, more }) }
export const clearFollowup = () => { answers.clear() }
