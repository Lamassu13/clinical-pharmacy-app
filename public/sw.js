// Basic offline app shell: reopening the tab with no signal shows the last-loaded app
// instead of the browser's own offline error page.
const SHELL_CACHE = 'cpa-shell-v1'
const APP_SHELL = ['/', '/index.html', '/favicon.png']
// Chart/pills/extra-pills data: network-first like everything else below, but on failure
// served from this separate cache instead of failing outright — the one thing that makes
// offline viewing/editing possible at all (see the app's own retry-on-failure autosave for
// what happens after that: it queues locally and flushes on reconnect). Every other /api/ GET
// (dashboard, medicines, announcements, treatment-forms, …) and every non-GET request stays
// untouched — nothing there is ever cached or served stale.
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
const CACHEABLE_API_PATHS = ['/api/chart', '/api/pills', '/api/extra-pills', '/api/medicines']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== SHELL_CACHE && key !== API_CACHE).map((key) => caches.delete(key)))),
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

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      // clone() must run synchronously, before the body is read anywhere else — deferring
      // it into the .then() below (after caches.open() resolves) clones an already-consumed
      // stream and throws "Response body is already used".
      const responseToCache = response.ok ? response.clone() : null
      if (responseToCache) event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.put(request, responseToCache)))
      return response
    })),
  )
})
