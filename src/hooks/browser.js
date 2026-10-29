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
