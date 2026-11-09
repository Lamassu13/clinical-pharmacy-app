// Helpers shared by the Google Form senders (albumin-google-form.js, tigecycline-google-form.js).

// The form's live structure from its page: Map(entry id → Set of its option texts, or null for a free box).
export const liveEntries = (html) => {
  const match = /FB_PUBLIC_LOAD_DATA_\s*=\s*([\s\S]*?);<\/script>/.exec(html || '')
  if (!match) return null
  try {
    const entries = new Map()
    for (const question of JSON.parse(match[1])[1][1]) {
      if (question[3] === 8) continue // a section break
      const [entry] = question[4]
      entries.set(String(entry[0]), entry[1] ? new Set(entry[1].map((option) => option[0]).filter(Boolean)) : null)
    }
    return entries
  } catch { return null }
}

// What in `body` (the answers about to be sent) the live form no longer has: a question id that is gone, or a
// chosen option whose text is not in the question any more. [] = the form still matches what the app sends.
export const mismatches = (body, entries) => {
  if (!entries) return ['تعذّرت قراءة النموذج']
  const found = []
  for (const [name, value] of body) {
    const match = /^entry\.(\d+)$/.exec(name)
    if (!match) continue
    if (!entries.has(match[1])) { found.push(`سؤال غير موجود (${match[1]})`); continue }
    const options = entries.get(match[1])
    if (options && value !== '__other_option__' && !options.has(value)) found.push(`خيار غير موجود: «${value.slice(0, 40)}»`)
  }
  return found
}

// The form page with these answers already filled in (Google's own pre-filled link): the pharmacist can finish
// the send there by hand, whatever the app could not send. Only the answers; not the routing fields.
export const prefillUrl = (formResponseUrl, body) => {
  const query = new URLSearchParams([['usp', 'pp_url'], ...body.filter(([name]) => name !== 'pageHistory' && name !== 'fvv')])
  return `${formResponseUrl.replace(/formResponse$/, 'viewform')}?${query}`
}
