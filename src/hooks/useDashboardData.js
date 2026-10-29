import { useCallback, useEffect, useState } from 'react'
import { apiUrl } from '../constants.js'
import { isoDate } from '../helpers.js'

export default function useDashboardData({ isLoggedIn, sessionExpired, floor, selected, adminView, isExpired, isManager, rangeFrom, rangeTo }) {
  // The floor-picker dashboard: today's ward-status summary. Loaded only while that screen is
  // actually showing.
  const [dashboardData, setDashboardData] = useState(null)
  // Set when GET /api/dashboard fails or returns nothing. Without it, dashboardData === null
  // during a slow load renders as a real "0 wards started, no medicines" state — a false alarm
  // that looks identical to a genuine quiet day. dashboardReloadKey lets the retry button
  // re-run the loader effect below.
  const [dashboardError, setDashboardError] = useState(false)
  const [dashboardReloadKey, setDashboardReloadKey] = useState(0)
  const retryDashboard = useCallback(() => { setDashboardData(null); setDashboardError(false); setDashboardReloadKey((key) => key + 1) }, [])

  // The dashboard aggregates — loaded for the floor-picker landing page and for لوحة التحكم
  // (which hosts the medicines + per-floor patients + daily-trend widgets), not carried along
  // while a chart or another admin screen is open.
  useEffect(() => {
    // Also re-runs when adminView clears, so returning from a screen that changed things
    // (a chart purge, an announcement) lands on fresh numbers rather than the stale set.
    if (!isLoggedIn || sessionExpired || floor || selected || (adminView && adminView !== 'dashboard')) return undefined
    let cancelled = false
    const date = isoDate(new Date())
    const rangeQuery = isManager && rangeFrom && rangeTo ? `&rangeFrom=${rangeFrom}&rangeTo=${rangeTo}` : ''
    fetch(`${apiUrl}/dashboard?date=${date}${rangeQuery}`, { credentials: 'include' })
      .then((response) => { isExpired(response); return response.ok ? response.json() : null })
      .then((result) => {
        if (cancelled) return
        if (result) { setDashboardData(result); setDashboardError(false) } else setDashboardError(true)
      })
      .catch(() => { if (!cancelled) setDashboardError(true) })
    return () => { cancelled = true }
  }, [isLoggedIn, sessionExpired, floor, selected, adminView, isExpired, isManager, rangeFrom, rangeTo, dashboardReloadKey])
  return { dashboardData, dashboardError, retryDashboard }
}
