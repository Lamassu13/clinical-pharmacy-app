// LoginTrainingClip — a 15s looping, captionless walkthrough of the login screen for
// onboarding new staff: title card -> login card -> username/password typing -> submit
// -> floor-selection dashboard peek. Colors/fonts/markup mirror the real login screen
// (App.jsx / App.css) but are kept as fixed values here so the clip renders identically
// regardless of the visitor's light/dark theme preference.
import { useEffect, useRef, useState } from 'react'
import hospitalLogo from './assets/hospital-logo.png'

const G = {
  green50: '#eef6f1', green100: '#d9ece1',
  green500: '#087c54', green700: '#08543b', green800: '#064d3e',
  bg: '#f5f8f6', surface: '#ffffff',
  border: '#dbe6df', borderStrong: '#b9cdc2',
  text: '#132a27', textMuted: '#4f6b63',
  danger: '#c92a33',
  primaryTint: '#087c541f',
  shadowMd: '0 12px 32px #12332618, 0 4px 12px #12332612',
  shadowXs: '0 1px 2px #0f2f2410, 0 1px 1px #0f2f240a',
  font: "'IBM Plex Sans Arabic', 'IBM Plex Sans', 'Geeza Pro', 'Segoe UI', system-ui, sans-serif",
}

const USERNAME = 'h.abdullah'
const PASSWORD_LEN = 10
const STAGE_WIDTH = 1920
const STAGE_HEIGHT = 1080
const DURATION = 15
// Cumulative start time of each authored scene (Title 2.6s, CardIn 1.8s, TypeUsername 2.6s,
// TypePassword 2.4s, Submit 1.6s, Dashboard 4.0s -> 15s total, then loops).
const CUES = { Title: 0, CardIn: 2.6, TypeUsername: 4.4, TypePassword: 7, Submit: 9.4, Dashboard: 11 }

const floors = [{ n: 2, wards: 3 }, { n: 3, wards: 2 }, { n: 4, wards: 2 }, { n: 5, wards: 3 }]

const clamp = (v, min, max) => Math.max(min, Math.min(max, v))
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1)
const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2 }
const easeOutCubic = (t) => { const u = t - 1; return u * u * u + 1 }
const easeOutQuad = (t) => t * (2 - t)
function interpolate(input, output, ease = (t) => t) {
  return (t) => {
    if (t <= input[0]) return output[0]
    if (t >= input[input.length - 1]) return output[output.length - 1]
    for (let i = 0; i < input.length - 1; i++) {
      if (t >= input[i] && t <= input[i + 1]) {
        const span = input[i + 1] - input[i]
        const local = span === 0 ? 0 : (t - input[i]) / span
        return output[i] + (output[i + 1] - output[i]) * ease(local)
      }
    }
    return output[output.length - 1]
  }
}
function animate({ from = 0, to = 1, start = 0, end = 1, ease = easeInOutCubic }) {
  return (t) => {
    if (t <= start) return from
    if (t >= end) return to
    return from + (to - from) * ease((t - start) / (end - start))
  }
}
function typedSlice(text, t0, t1, T) {
  const p = clamp((T - t0) / (t1 - t0), 0, 1)
  return text.slice(0, Math.round(text.length * p))
}

// Drives T forward at real time, looping forever while mounted. Paused (frozen on the
// title card) under prefers-reduced-motion.
function useClipClock(duration) {
  const [t, setT] = useState(0)
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined
    let raf
    let last = null
    // performance.now(), not the rAF callback's own timestamp argument: under a throttled or
    // heavily loaded tab, consecutive callback timestamps have been observed to under-report
    // real elapsed time, which would make the clip drift out of sync with real time.
    const tick = () => {
      const now = performance.now()
      if (last != null) setT((prev) => (prev + (now - last) / 1000) % duration)
      last = now
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [duration])
  return t
}

// Scales the fixed 1920x1080 authored canvas down to fit whatever width its container gives it.
function useAutoScale(width) {
  const ref = useRef(null)
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const measure = () => setScale(Math.max(0.05, el.clientWidth / width))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [width])
  return [ref, scale]
}

export default function LoginTrainingClip() {
  const T = useClipClock(DURATION)
  const [wrapRef, scale] = useAutoScale(STAGE_WIDTH)

  // ── continuous logo + wordmark motion (Title -> CardIn -> Dashboard) ──
  const logoToCard = animate({ from: 0, to: 1, start: CUES.Title + 0.3, end: CUES.CardIn + 0.9, ease: easeInOutCubic })
  const cardToTopbar = animate({ from: 0, to: 1, start: CUES.Dashboard - 0.1, end: CUES.Dashboard + 0.9, ease: easeInOutCubic })
  const lc = logoToCard(T), ct = cardToTopbar(T)

  // logo: big centered (title) -> 116px atop card -> 42px in topbar (dashboard)
  const logoSizeA = interpolate([0, 1], [176, 116])(lc)
  const logoSize = interpolate([0, 1], [logoSizeA, 42])(ct)
  const logoCenterX = 960, logoCenterY = 340
  const cardTop = 328 // authored top edge of the login card box
  const logoCardX = 960, logoCardY = cardTop + 24 + 58 // 24px padding + half logo height, fully inside the card
  const logoTopbarX = 76, logoTopbarY = 54
  const lx1 = interpolate([0, 1], [logoCenterX, logoCardX])(lc)
  const ly1 = interpolate([0, 1], [logoCenterY, logoCardY])(lc)
  const logoX = interpolate([0, 1], [lx1, logoTopbarX])(ct)
  const logoY = interpolate([0, 1], [ly1, logoTopbarY])(ct)
  const logoRadius = interpolate([0, 1], [24, 10])(lc)

  // title text: big centered -> h1 in card -> fades out for dashboard heading
  const logoBottomInCard = cardTop + 24 + 116 // logo's bottom edge once resting inside the card
  const eyebrowCardY = logoBottomInCard + 31
  const titleCardY = eyebrowCardY + 45
  const titleSize = interpolate([0, 1], [44, 22])(lc)
  const titleY1 = interpolate([0, 1], [472, titleCardY])(lc) // clears the logo + eyebrow
  const titleOpacity = animate({ from: 1, to: 0, start: CUES.Submit + 0.3, end: CUES.Dashboard - 0.1 })(T)

  // ── card box ──
  const cardIn = animate({ from: 0, to: 1, start: CUES.Title + 0.5, end: CUES.CardIn + 1.1, ease: easeOutBack })
  const cardOut = animate({ from: 1, to: 0, start: CUES.Submit + 0.5, end: CUES.Dashboard + 0.3, ease: easeInOutCubic })
  const cardScale = cardIn(T) * (0.94 + 0.06 * cardOut(T))
  const cardOpacity = clamp(cardIn(T), 0, 1) * cardOut(T)

  const introOpacity = animate({ from: 0, to: 1, start: CUES.CardIn + 0.5, end: CUES.CardIn + 1.1 })(T) * cardOut(T)
  const eyebrowY = interpolate([0, 1], [252, eyebrowCardY])(lc) // sits between the logo and the title, inside the card

  // ── form fields ──
  const fieldsIn = animate({ from: 0, to: 1, start: CUES.CardIn + 0.7, end: CUES.CardIn + 1.4 })(T)
  const userFocus = animate({ from: 0, to: 1, start: CUES.TypeUsername - 0.15, end: CUES.TypeUsername + 0.15 })(T)
    * animate({ from: 1, to: 0, start: CUES.TypePassword - 0.15, end: CUES.TypePassword + 0.1 })(T)
  const passFocus = animate({ from: 0, to: 1, start: CUES.TypePassword - 0.15, end: CUES.TypePassword + 0.15 })(T)
    * animate({ from: 1, to: 0, start: CUES.Submit - 0.15, end: CUES.Submit + 0.1 })(T)
  const usernameTyped = typedSlice(USERNAME, CUES.TypeUsername, CUES.TypePassword - 0.2, T)
  const passwordDots = '•'.repeat(Math.round(PASSWORD_LEN * clamp((T - CUES.TypePassword) / (CUES.Submit - 0.2 - CUES.TypePassword), 0, 1)))
  const showCaretUser = userFocus > 0.5 && usernameTyped.length < USERNAME.length
  const showCaretPass = passFocus > 0.5 && passwordDots.length < PASSWORD_LEN
  const caretBlink = Math.sin(T * 9) > 0

  // ── submit button ──
  const btnPress = animate({ from: 0, to: 1, start: CUES.Submit, end: CUES.Submit + 0.18, ease: easeOutQuad })(T)
    * animate({ from: 1, to: 0, start: CUES.Submit + 0.35, end: CUES.Submit + 0.55 })(T)
  const loading = animate({ from: 0, to: 1, start: CUES.Submit + 0.15, end: CUES.Submit + 0.4 })(T)
    * animate({ from: 1, to: 0, start: CUES.Dashboard - 0.5, end: CUES.Dashboard - 0.1 })(T)

  // ── dashboard ──
  const dashIn = animate({ from: 0, to: 1, start: CUES.Dashboard + 0.1, end: CUES.Dashboard + 0.9, ease: easeOutCubic })
  const dashOpacity = dashIn(T)
  const dashY = interpolate([0, 1], [24, 0])(dashIn(T))

  // slow continuous Ken-Burns breathing over the whole piece
  const breathe = 1 + 0.018 * Math.sin(T * 0.35)
  const bgFade = animate({ from: 1, to: 0, start: CUES.Submit + 0.6, end: CUES.Dashboard + 0.4 })(T)

  return (
    <div ref={wrapRef} style={{ width: '100%', aspectRatio: `${STAGE_WIDTH} / ${STAGE_HEIGHT}`, overflow: 'hidden', position: 'relative', background: G.bg }}>
      <div style={{ width: STAGE_WIDTH, height: STAGE_HEIGHT, position: 'absolute', top: 0, left: 0, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        <div style={{ position: 'absolute', inset: 0, background: G.bg, fontFamily: G.font, overflow: 'hidden', transform: `scale(${breathe})`, transformOrigin: '50% 42%' }}>
          {/* radial gradient wash (login-shell background) */}
          <div style={{ position: 'absolute', inset: 0, opacity: bgFade, background: `radial-gradient(circle at 18% 8%, ${G.green100} 0, transparent 32%)` }} />

          {/* login card (rendered before logo/eyebrow/title so they stack visibly on top of it) */}
          <div style={{
            position: 'absolute', left: 960, top: cardTop, width: 560,
            transform: `translateX(-50%) scale(${cardScale})`, transformOrigin: 'top center', opacity: cardOpacity,
            background: G.surface, border: `1px solid ${G.border}`, borderRadius: 22,
            boxShadow: G.shadowMd, padding: '64px 56px 48px', direction: 'rtl',
          }}>
            <p style={{ opacity: introOpacity, color: G.textMuted, fontSize: 17, lineHeight: 1.6, margin: '200px 0 0' }}>
              سجل الدخول للوصول إلى جداول الجارت اليومية
            </p>

            <div style={{ opacity: fieldsIn, marginTop: 34 }}>
              <label style={{ display: 'block', color: G.green800, fontSize: 15, fontWeight: 700, marginBottom: 8 }}>اسم المستخدم</label>
              <div style={{
                border: `1px solid ${userFocus > 0.5 ? G.green500 : G.borderStrong}`, borderRadius: 10,
                padding: '15px 18px', fontSize: 17, color: G.text, background: G.surface,
                boxShadow: userFocus > 0.5 ? `0 0 0 3px ${G.primaryTint}` : 'none', minHeight: 26,
              }}>
                {usernameTyped}{showCaretUser && caretBlink ? '|' : ''}
              </div>
            </div>

            <div style={{ opacity: fieldsIn, marginTop: 22 }}>
              <label style={{ display: 'block', color: G.green800, fontSize: 15, fontWeight: 700, marginBottom: 8 }}>كلمة المرور</label>
              <div style={{
                border: `1px solid ${passFocus > 0.5 ? G.green500 : G.borderStrong}`, borderRadius: 10,
                padding: '15px 18px', fontSize: 19, color: G.text, background: G.surface, letterSpacing: 3,
                boxShadow: passFocus > 0.5 ? `0 0 0 3px ${G.primaryTint}` : 'none', minHeight: 26,
              }}>
                {passwordDots}{showCaretPass && caretBlink ? '|' : ''}
              </div>
            </div>

            <div style={{
              opacity: fieldsIn, marginTop: 30, background: interpolate([0, 1], [G.green500, G.green700])(btnPress),
              color: '#fff', borderRadius: 999, padding: '16px 0', fontSize: 16, fontWeight: 700,
              textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              transform: `scale(${1 - 0.02 * btnPress})`,
            }}>
              {loading > 0.5
                ? <span style={{ width: 18, height: 18, borderRadius: '50%', border: '2.5px solid #ffffff55', borderTopColor: '#fff', transform: `rotate(${T * 720}deg)`, display: 'inline-block' }} />
                : <span>تسجيل الدخول ←</span>}
            </div>
          </div>

          {/* eyebrow + hospital name (fades before dashboard) — on top of the card */}
          <div style={{ position: 'absolute', left: 960, top: eyebrowY, transform: 'translate(-50%,-50%)', opacity: titleOpacity, color: G.danger, fontWeight: 700, fontSize: 15, letterSpacing: '0.01em' }}>
            مستشفى بغداد التعليمي
          </div>

          {/* logo (persists, morphs size/position across the whole piece) — on top of the card */}
          <img src={hospitalLogo} alt="" style={{ position: 'absolute', left: logoX, top: logoY, width: logoSize, height: logoSize, transform: 'translate(-50%,-50%)', borderRadius: logoRadius, objectFit: 'contain' }} />

          {/* title text (Title -> h1 in card, fades out toward Dashboard) — on top of the card */}
          <div style={{ position: 'absolute', left: 960, top: titleY1, transform: 'translate(-50%,-50%)', opacity: titleOpacity, color: G.green800, fontWeight: 700, fontSize: titleSize, textAlign: 'center', direction: 'rtl' }}>
            وحدة الصيدلة السريرية
          </div>

          {/* ── dashboard peek ── */}
          <div style={{ position: 'absolute', inset: 0, opacity: dashOpacity, pointerEvents: 'none' }}>
            <div style={{
              position: 'absolute', left: 0, top: 0, width: '100%', height: 88, background: G.surface,
              borderBottom: `1px solid ${G.border}`, boxShadow: G.shadowXs, display: 'flex', alignItems: 'center',
              padding: '0 56px', direction: 'rtl', transform: `translateY(${dashY}px)`,
            }}>
              <div style={{ marginRight: 130 }}>
                <strong style={{ display: 'block', color: G.green800, fontSize: 16 }}>الصيدلة السريرية</strong>
                <small style={{ display: 'block', color: G.textMuted, fontSize: 12 }}>مستشفى بغداد التعليمي</small>
              </div>
              <div style={{ marginRight: 'auto', color: G.textMuted, fontSize: 14 }}>الحسين عبدالله</div>
            </div>

            <div style={{ position: 'absolute', left: '50%', top: 190, width: 1380, transform: `translate(-50%,${dashY}px)`, direction: 'rtl' }}>
              <p style={{ color: G.danger, fontSize: 12, fontWeight: 700, margin: '0 0 8px' }}>مساحة العمل اليومية</p>
              <h1 style={{ color: G.green800, fontSize: 34, fontWeight: 700, margin: 0 }}>اختر الطابق أو الردهة</h1>
            </div>

            <div style={{
              position: 'absolute', left: '50%', top: 330, width: 1380, transform: `translate(-50%,${dashY}px)`,
              display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20, direction: 'rtl',
            }}>
              {floors.map((f) => (
                <div key={f.n} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '22px 26px', border: `1px solid ${G.border}`, borderRadius: 14, background: G.surface, boxShadow: G.shadowXs }}>
                  <span style={{ width: 48, height: 48, borderRadius: 12, background: G.green100, color: G.green500, display: 'grid', placeItems: 'center', fontSize: 19, fontWeight: 700, flexShrink: 0 }}>{f.n}</span>
                  <span>
                    <strong style={{ display: 'block', color: G.text, fontSize: 16 }}>{`الطابق ${f.n}`}</strong>
                    <small style={{ display: 'block', color: G.textMuted, fontSize: 12, marginTop: 4 }}>{`${f.wards} أروقة فرعية`}</small>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
