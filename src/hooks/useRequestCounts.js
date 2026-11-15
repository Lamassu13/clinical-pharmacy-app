import { useEffect, useState } from 'react'
import { apiUrl } from '../constants.js'

// How many «استمارة الميرونيم» / «استمارة الالبومين» forms a ward has for a day ({ meropenem, albumin }),
// for the ward page's rows and the work steps bar. `ward` is { floor, ward } or null (nothing asked).
// `refreshKey` changes when the person moves between screens (a saved form changes the count). Offline,
// or before the answer arrives, it is null: shown as nothing rather than a guess. The answer is kept with
// the ward and day it was asked for, so a slower reply for another ward is never shown here.
// `path` / `read`: another list to count the same way (the dispensing form's, for its «مواقف القسم» tile: abxListCounts).
export default function useRequestCounts({ ward, selectedDate, isOnline, isExpired, refreshKey, path = 'drug-requests/counts', read = (result) => result }) {
  const key = ward ? `${ward.floor || ''}|${ward.ward}|${selectedDate}` : ''
  const [loaded, setLoaded] = useState(null)
  useEffect(() => {
    if (!ward || !isOnline) return undefined
    let cancelled = false
    const params = new URLSearchParams({ floor: ward.floor || '', ward: ward.ward, date: selectedDate })
    fetch(`${apiUrl}/${path}?${params}`, { credentials: 'include' })
      .then((response) => { isExpired(response); return response.ok && response.headers.get('x-from-cache') !== '1' ? response.json() : null })
      .then((result) => { if (!cancelled && result) setLoaded({ key, counts: read(result) }) })
      .catch(() => {})
    return () => { cancelled = true }
  // `ward` is a new object each render; its parts are in `key`.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, path, isOnline, isExpired, refreshKey])
  return isOnline && ward && loaded?.key === key ? loaded.counts : null
}
