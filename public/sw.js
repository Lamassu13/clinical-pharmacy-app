// Basic offline app shell: reopening the tab with no signal shows the last-loaded app
// instead of the browser's own offline error page.
// Both placeholders are filled by vite.config.js (precacheServiceWorker) at build time: every
// hashed file in dist/assets, and a hash of that list naming this build's shell cache. Unfilled,
// this falls back to the old fixed cache and cache-on-first-use only.
const PRECACHE = '__PRECACHE__'
const BUILD_HASH = '__BUILD_HASH__'
const PRECACHE_LIST = Array.isArray(PRECACHE) ? PRECACHE : []
const SHELL_CACHE = BUILD_HASH === '__BUILD' + '_HASH__' ? 'cpa-shell-v1' : `cpa-shell-${BUILD_HASH}`
const APP_SHELL = ['/', '/index.html', '/favicon.png']
// Chart/pills/extra-pills data: network-first like everything else below, but on failure
// served from this separate cache instead of failing outright — the one thing that makes
// offline viewing/editing possible at all (see the app's own retry-on-failure autosave for
// what happens after that: it queues locally and flushes on reconnect). Every other /api/ GET
// (auth/me, users, admin lists, …) and every non-GET request stays untouched — nothing there is
// ever cached or served stale.
//
// Deliberately NOT /api/auth/me: the Cache API keys purely by URL, with no notion of *whose*
// session produced a cached response. On the shared ward iPads this app runs on, caching that
// endpoint could resurface one pharmacist's identity to whoever logs in next if the network
// happens to blip at exactly the wrong moment. The app's own cpa-session-cache in localStorage
// already covers "reopen the app offline as the same signed-in user" — and unlike this cache,
// it's explicitly cleared on logout (see App.jsx's logout()) and on a real 401, so it can't
// leak across a login switch on the same device.
const API_CACHE = 'cpa-api-v1'
// /api/medicines too: the shared catalogue (identical for every user, nothing personal in it). A
// chart column only accepts a catalogue name, so without it a chart opened offline could take no
// medicines at all.
// The rest are read-only screens and lookups (templates, interactions, patient search/history,
// the ward note, antibiotic follow-up), so they still show their last copy offline. All are
// dropped with this cache at logout.
const CACHEABLE_API_PATHS = ['/api/chart', '/api/pills', '/api/extra-pills', '/api/medicines',
  '/api/templates', '/api/interactions', '/api/patients/search', '/api/patients/history', '/api/ward-note', '/api/antibiotics',
  '/api/antibiotics/long', '/api/meropenem', '/api/dashboard', '/api/announcements', '/api/treatment-forms',
  '/api/order', '/api/meropenem-order', '/api/renal-doses']

self.addEventListener('install', (event) => {
  // The page itself is required, as before. The precache is best effort, one file at a time: a
  // file that fails on a weak link is just fetched and cached on first use later, instead of
  // failing the whole install (addAll is all-or-nothing).
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL)
    .then(() => Promise.all(['/theme.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png', ...PRECACHE_LIST].map((url) => cache.add(url).catch(() => {}))))))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  // Keep the previous build's shell too (caches.keys() is in creation order): a tab left open
  // across a deploy still runs that build, and its lazily loaded files (the PDF export) are gone
  // from the server. Anything older is dropped.
  event.waitUntil(
    caches.keys().then((keys) => {
      const previousShell = keys.filter((key) => key.startsWith('cpa-shell-') && key !== SHELL_CACHE).pop()
      const keep = new Set([SHELL_CACHE, API_CACHE, previousShell])
      return Promise.all(keys.filter((key) => !keep.has(key)).map((key) => caches.delete(key)))
    }),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (CACHEABLE_API_PATHS.some((path) => url.pathname === path)) {
    event.respondWith(
      fetch(request).then((response) => {
        const responseToCache = response.ok ? response.clone() : null
        if (responseToCache) event.waitUntil(caches.open(API_CACHE).then((cache) => cache.put(request, responseToCache)))
        return response
      }).catch(() => caches.match(request).then((cached) => {
        if (!cached) return cached
        // Flag it: this copy is only as new as the last successful GET, never this device's own
        // saves, so the app must not merge it as if it were the server's current state.
        const headers = new Headers(cached.headers)
        headers.set('x-from-cache', '1')
        return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers })
      })),
    )
    return
  }
  if (url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    // Refresh the offline copy on every online load. Cached only at install, it stayed whatever
    // build was live the last time sw.js itself changed, so an offline cold start ran that old
    // build — or a blank page, when its hashed scripts had never been cached.
    event.respondWith(fetch(request).then((response) => {
      const isPage = response.ok && (response.headers.get('content-type') || '').includes('text/html')
      const responseToCache = isPage ? response.clone() : null
      if (responseToCache) event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', responseToCache)))
      return response
    }).catch(() => caches.match('/index.html')))
    return
  }

  // ignoreVary: the server answers with `Vary: Origin`, and a module import() sends an Origin
  // header that the precache request didn't, so without it a lazily loaded chunk (the PDF
  // export) never matched its cached copy — offline, or in a tab left open across a deploy.
  // Safe here: these files are content-hashed and never change.
  event.respondWith(
    caches.match(request, { ignoreVary: true }).then((cached) => cached || fetch(request).then((response) => {
      // clone() must run synchronously, before the body is read anywhere else — deferring
      // it into the .then() below (after caches.open() resolves) clones an already-consumed
      // stream and throws "Response body is already used".
      // A missing /assets/ file gets the SPA's index.html with a 200 — never store that page
      // under a script's URL, or the bad copy would be served from cache from then on.
      const isPage = (response.headers.get('content-type') || '').includes('text/html')
      const responseToCache = response.ok && !(isPage && url.pathname.startsWith('/assets/')) ? response.clone() : null
      if (responseToCache) event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.put(request, responseToCache)))
      return response
    })),
  )
})

// Web push (server/push.js). Safari cancels a subscription whose pushes show nothing, so every
// push shows something — the generic text if the payload cannot be read.
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { /* unreadable payload: generic text below */ }
  event.waitUntil(self.registration.showNotification(data.title || 'وحدة الصيدلة السريرية', {
    body: data.body || 'لديك إشعار جديد',
    tag: data.tag || undefined,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    dir: 'rtl',
    lang: 'ar',
  }))
})

// The app has no router, so a tap just brings the app forward (or opens it).
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => (windows[0] ? windows[0].focus() : self.clients.openWindow('/'))))
})
