import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/ibm-plex-sans-arabic/arabic-400.css'
import '@fontsource/ibm-plex-sans-arabic/arabic-500.css'
import '@fontsource/ibm-plex-sans-arabic/arabic-600.css'
import '@fontsource/ibm-plex-sans-arabic/arabic-700.css'
import '@fontsource/ibm-plex-sans-arabic/latin-400.css'
import '@fontsource/ibm-plex-sans-arabic/latin-500.css'
import '@fontsource/ibm-plex-sans-arabic/latin-600.css'
import '@fontsource/ibm-plex-sans-arabic/latin-700.css'
import './index.css'
import App from './App.jsx'
import { hydrateStorage } from './storage.js'
import { initErrorReporter, reportError } from './error-reporter.js'

initErrorReporter()

// Facebook (fbclid), Google (gclid/…), Mailchimp (mc_*), utm_* etc. append click-tracking
// params when the link is opened from their platforms. The app never reads its own query
// string, so drop the known ones from the address bar on load to keep a copied or
// bookmarked URL short. replaceState — no navigation, no reload.
try {
  const url = new URL(window.location.href)
  const original = url.search
  const drop = ['fbclid', 'gclid', 'gbraid', 'wbraid', 'dclid', 'msclkid', 'yclid', 'twclid',
    'ttclid', 'igshid', 'mc_cid', 'mc_eid', '_hsenc', '_hsmi']
  for (const key of drop) url.searchParams.delete(key)
  for (const key of [...url.searchParams.keys()]) if (key.startsWith('utm_')) url.searchParams.delete(key)
  if (url.search !== original) window.history.replaceState(null, '', url.pathname + url.search + url.hash)
} catch { /* opaque or unsupported URL — leave the bar as-is */ }

// Drafts and offline copies load from IndexedDB before the first render, so the app can keep
// reading them synchronously. hydrateStorage() never rejects (it falls back to localStorage).
hydrateStorage().then(() => {
  // React 19 hands uncaught render errors here instead of to window 'error', and only here is the
  // component stack available (a render loop like #185 says nothing else about where it is).
  createRoot(document.getElementById('root'), {
    onUncaughtError: (error, { componentStack }) => {
      console.error(error)
      reportError('error', error?.message, String(componentStack || '').trim().split('\n').slice(0, 4).map((line) => line.trim().replace(/^at /, '')).join(' < '))
    },
  }).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
// Ask the browser not to evict this device's drafts under storage pressure (no-op where unsupported).
try { navigator.storage?.persist?.().catch(() => {}) } catch { /* unsupported */ }

// Registered only in production: a dev-mode service worker would cache Vite's dev
// assets and fight with hot-reload the next time the code changes.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  let registration
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').then((reg) => { registration = reg }).catch(() => {}))

  // An app on the home screen is resumed, not reopened, so the browser never looks for a new
  // sw.js and a deploy stayed unseen until the app was closed. Look every time it comes back to
  // the front, and every 30 minutes while it stays open.
  const checkForUpdate = () => { registration?.update().catch(() => {}) }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate() })
  setInterval(checkForUpdate, 30 * 60 * 1000)

  // The new worker takes over by itself (sw.js skipWaiting + clients.claim), but this page keeps
  // running the old build until it reloads. Reload once, and never while a field has focus: the
  // reload's pagehide still saves, but not under the pharmacist's fingers. The first takeover
  // (the very first install) is not an update.
  let controlled = !!navigator.serviceWorker.controller
  let reloading = false
  const reloadWhenNotTyping = () => {
    const el = document.activeElement
    if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) { setTimeout(reloadWhenNotTyping, 3000); return }
    window.location.reload()
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!controlled) { controlled = true; return }
    if (reloading) return
    reloading = true
    reloadWhenNotTyping()
  })
}
