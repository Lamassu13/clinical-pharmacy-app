// Helpers shared by the Google Form senders (albumin-google-form.js, tigecycline-google-form.js).

// The form's live structure from its page: { entries: Map(entry id → Set of its option texts, or null for a free box),
// required: Set(entry ids of the questions that must be answered), titles: Map(entry id → the question's title), pages: Map(entry id → the page it is on, counting the section breaks before it — what a body's pageHistory lists), signIn }. `signIn`: the form collects VERIFIED email addresses (its setting is 2; 1 = no email, which the albumin
// form has), so Google asks every filler to sign in and a post from the server is refused. Seen on 2026-11-09 on the
// tigecycline form: its page opens a «you must sign in» box.
export const liveForm = (html) => {
  const match = /FB_PUBLIC_LOAD_DATA_\s*=\s*([\s\S]*?);<\/script>/.exec(html || '')
  if (!match) return null
  try {
    const data = JSON.parse(match[1])
    const entries = new Map()
    const required = new Set()
    const titles = new Map()
    const pages = new Map()
    let page = 0
    for (const question of data[1][1]) {
      if (question[3] === 8) page += 1 // a section break: the next page
      if (question[3] === 8 || !question[4]) continue // (or a text block with no question)
      const [entry] = question[4]
      entries.set(String(entry[0]), entry[1] ? new Set(entry[1].map((option) => option[0]).filter(Boolean)) : null)
      titles.set(String(entry[0]), String(question[1] || '').trim())
      pages.set(String(entry[0]), page)
      if (entry[2] === 1) required.add(String(entry[0]))
    }
    // `signIn` is null when the page does not carry the setting (Google moved it): unknown, never read as «no sign-in».
    const email = data[1][10]?.[6]
    return { entries, required, titles, pages, signIn: email == null ? null : email === 2 }
  } catch { return null }
}
export const liveEntries = (html) => liveForm(html)?.entries ?? null

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

// The question ids an answer body carries (a date's month/day parts and an «other» text belong to their question).
export const answeredIds = (body) => new Set(body.map(([name]) => /^entry\.(\d+)/.exec(name)?.[1]).filter(Boolean))

// The titles of the live form's required questions that none of `bodies` (sample answers covering every branch) answers: a question
// added to the form since the app was written. Only the pages the samples visit count (their pageHistory): a required question on a
// branch page the app never takes (the albumin form's «other diagnosis») is not asked of it. [] = nothing new is asked.
export const newRequired = (bodies, live) => {
  const answered = new Set(bodies.flatMap((body) => [...answeredIds(body)]))
  const visited = new Set(bodies.flatMap((body) => String(body.find(([name]) => name === 'pageHistory')?.[1] ?? '').split(',').filter(Boolean).map(Number)))
  return [...live.required].filter((id) => !answered.has(id) && (!visited.size || visited.has(live.pages.get(id) ?? 0))).map((id) => live.titles.get(id) || id)
}
