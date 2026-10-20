import { apiUrl } from './constants.js'

// Web push on the client. Everything here is guarded: the ward devices include old iPads with no
// PushManager or Notification at all, and none of this may throw there.

const isAppleTouch = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

// 'ready' | 'denied' | 'needs-home-screen' | 'unsupported'
export const pushSupport = () => {
  try {
    if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) {
      return Notification.permission === 'denied' ? 'denied' : 'ready'
    }
    // An iPad/iPhone only gets PushManager once the app is on the home screen (16.4+), so with
    // none we cannot tell an old device from a browser tab: ask for the home screen either way.
    return isAppleTouch() ? 'needs-home-screen' : 'unsupported'
  } catch { return 'unsupported' }
}

const toBytes = (base64Url) => {
  const padded = (base64Url + '='.repeat((4 - (base64Url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  return Uint8Array.from(raw, (char) => char.charCodeAt(0))
}

const registration = () => (navigator.serviceWorker ? navigator.serviceWorker.getRegistration() : Promise.resolve(undefined))
const send = (method, body) => fetch(`${apiUrl}/push/subscribe`, { method, headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) })

export const fetchPushKey = async () => {
  try {
    const response = await fetch(`${apiUrl}/push/key`, { credentials: 'include' })
    return response.ok ? (await response.json()).key || null : null
  } catch { return null }
}

export const currentSubscription = async () => {
  try { const reg = await registration(); return reg ? await reg.pushManager.getSubscription() : null } catch { return null }
}

// Must run straight from a tap: Safari drops the gesture after an await, so the permission prompt
// is the first thing this does and the key is fetched beforehand.
export const enablePush = async (key) => {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'dismissed'
  const reg = await registration()
  if (!reg || !key) return 'unavailable'
  const subscription = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(key) })
  const response = await send('POST', subscription.toJSON())
  return response.ok ? 'on' : 'failed'
}

export const disablePush = async () => {
  const subscription = await currentSubscription()
  if (!subscription) return
  try { await send('DELETE', { endpoint: subscription.endpoint }) } catch { /* the server also drops it at sign-out */ }
  try { await subscription.unsubscribe() } catch { /* already gone */ }
}

// After every sign-in: a device that already allowed notifications re-registers itself for whoever
// is signed in now (the server ties a subscription to the login session). No prompt, no tap.
export const syncPushSubscription = async () => {
  try {
    if (pushSupport() !== 'ready' || Notification.permission !== 'granted') return
    const subscription = await currentSubscription()
    if (subscription) await send('POST', subscription.toJSON())
  } catch { /* best effort */ }
}
