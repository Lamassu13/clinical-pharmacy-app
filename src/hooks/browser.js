import { useEffect, useState } from 'react'

// True while this tab is in the foreground. App's polling effects gate on it so a
// backgrounded or screen-locked iPad stops hitting the server (and the Neon compute endpoint)
// every few seconds — it has nothing to show until it's looked at again.
export function useDocumentVisible() {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || !document.hidden)
  useEffect(() => {
    const onChange = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  return visible
}

// True while the browser reports connectivity. Drives the one top-level "غير متصل" banner and
// lets the extra-pills queue (which has no fixed retry timer of its own — useExtraPills) flush the
// instant the network returns instead of waiting for the next screen visit.
export function useOnlineStatus() {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine)
  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline) }
  }, [])
  return online
}

// Keeps the screen on while `active` (a ward screen is open), so the tablet does not lock
// mid-chart during the round. Where the API is missing (older iPads, Safari before 16.4) it does
// nothing. Released after `idleMs` without a touch or key, so a tablet left open on a chart does
// not stay lit (and keep renewing its chart edit lock); the next touch takes the lock again. The browser drops it when the tab is hidden,
// so it is re-taken when the tab comes back.
export function useWakeLock(active, idleMs = 5 * 60 * 1000) {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !navigator.wakeLock) return undefined
    let lock = null
    let asking = false
    let stopped = false
    let idle = null
    const release = () => { const held = lock; lock = null; if (held) held.release().catch(() => undefined) }
    const acquire = () => {
      if (lock || asking || stopped || document.hidden) return
      asking = true
      navigator.wakeLock.request('screen').then((granted) => {
        asking = false
        if (stopped) { granted.release().catch(() => undefined); return }
        lock = granted
        granted.addEventListener('release', () => { if (lock === granted) lock = null })
      }).catch(() => { asking = false })
    }
    const touch = () => { clearTimeout(idle); idle = setTimeout(release, idleMs); acquire() }
    const onVisible = () => { if (!document.hidden) touch() }
    touch()
    window.addEventListener('pointerdown', touch, true)
    window.addEventListener('keydown', touch, true)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      clearTimeout(idle)
      window.removeEventListener('pointerdown', touch, true)
      window.removeEventListener('keydown', touch, true)
      document.removeEventListener('visibilitychange', onVisible)
      release()
    }
  }, [active, idleMs])
}
