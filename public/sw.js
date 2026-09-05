// Basic offline app shell: reopening the tab with no signal shows the last-loaded app
// instead of the browser's own offline error page. Nothing under /api/ is ever cached —
// chart and pill data must always come from the network, never a stale offline copy.
const SHELL_CACHE = 'cpa-shell-v1'
const APP_SHELL = ['/', '/index.html', '/favicon.png']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key)))),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/index.html')))
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
