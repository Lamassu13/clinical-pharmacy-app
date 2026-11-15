import { useEffect, useState } from 'react'
import { apiUrl } from '../constants.js'
import { isoDate } from '../helpers.js'

// Today's dispensing-form patients still to fill, per ward ([{ floor, ward, n }]; floor null = ICU), for the floor banner. Its own request:
// the server needs 1–2 s to count it, which must not hold up the dashboard. `floor`: ask for that floor (any user who may open it);
// without it, the user's own scope. `enabled` false: nothing to ask (a manager's own-scope answer is always empty). Asked each time
// the screen mounts, and the answer is kept with what it was asked for, so another floor's reply is never shown. Until it lands, or if
// it fails, [] — no line rather than a wrong one.
export default function useAbxPending({ floor, enabled = true, isExpired }) {
  const date = isoDate(new Date())
  const key = `${floor ?? ''}|${date}`
  const [loaded, setLoaded] = useState(null)
  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    const params = new URLSearchParams(floor ? { date, floor } : { date })
    fetch(`${apiUrl}/drug-requests/pending-abx?${params}`, { credentials: 'include' })
      .then((response) => { isExpired?.(response); return response.ok ? response.json() : null })
      .then((result) => { if (!cancelled && result) setLoaded({ key, abx: result.abx ?? [] }) })
      .catch(() => { /* no line rather than a wrong one */ })
    return () => { cancelled = true }
  }, [enabled, floor, date, key, isExpired])
  return enabled && loaded?.key === key ? loaded.abx : []
}
