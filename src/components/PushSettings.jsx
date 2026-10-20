import { useEffect, useState } from 'react'
import { pushSupport, fetchPushKey, currentSubscription, enablePush, disablePush } from '../push.js'

const MESSAGES = {
  unsupported: 'الإشعارات غير مدعومة على هذا الجهاز.',
  'needs-home-screen': 'لتفعيل الإشعارات أضف التطبيق إلى الشاشة الرئيسية (يلزم iOS أو iPadOS 16.4 أو أحدث).',
  denied: 'الإشعارات محظورة لهذا التطبيق. فعّلها من إعدادات الجهاز ثم عد إلى هنا.',
  unavailable: 'الإشعارات غير متاحة حاليًا على الخادم.',
}

export default function PushSettings({ isManager }) {
  const support = pushSupport()
  const [key, setKey] = useState(undefined) // undefined: still asking, null: server has none
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (support !== 'ready' && support !== 'denied') return undefined
    let cancelled = false
    fetchPushKey().then((value) => { if (!cancelled) setKey(value) })
    currentSubscription().then((subscription) => { if (!cancelled) setOn(Boolean(subscription)) })
    return () => { cancelled = true }
  }, [support])

  const turnOn = async () => {
    setBusy(true); setError('')
    try {
      const result = await enablePush(key)
      if (result === 'on') setOn(true)
      else if (result !== 'dismissed') setError(result === 'denied' ? MESSAGES.denied : 'تعذّر تفعيل الإشعارات. حاول مرة أخرى.')
    } catch { setError('تعذّر تفعيل الإشعارات. حاول مرة أخرى.') }
    setBusy(false)
  }
  const turnOff = async () => { setBusy(true); setError(''); await disablePush(); setOn(false); setBusy(false) }

  let body
  if (support !== 'ready') body = <p className="muted">{MESSAGES[support]}</p>
  else if (key === undefined) body = <p className="muted">…</p>
  else if (key === null) body = <p className="muted">{MESSAGES.unavailable}</p>
  else if (on) body = <button type="button" className="secondary-button" onClick={turnOff} disabled={busy}>إيقاف الإشعارات على هذا الجهاز</button>
  else body = <button type="button" className="primary-button" onClick={turnOn} disabled={busy}>تفعيل الإشعارات على هذا الجهاز</button>

  return <div className="dashboard-widget profile-card push-settings">
    <h2>الإشعارات</h2>
    <p className="muted">{isManager ? 'تنبيه عند إعلان جديد، وطلب انضمام جديد، وبدء جارت.' : 'تنبيه عند نشر إعلان جديد.'} تتوقف عند تسجيل الخروج.</p>
    {body}
    {on && <p className="form-success" role="status">الإشعارات مفعّلة على هذا الجهاز.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>
}
