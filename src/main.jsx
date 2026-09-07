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

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Registered only in production: a dev-mode service worker would cache Vite's dev
// assets and fight with hot-reload the next time the code changes.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'))
}
