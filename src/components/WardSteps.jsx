import { useLayoutEffect, useRef } from 'react'
import { formsWord } from '../helpers.js'
import { ChevronStart } from './WardGlyph.jsx'

// The step bar and the «الخطوة التالية» button (the steps themselves: ../wardSteps.js).

// Where the highlight was on the previous screen (on the page, in px). The bar is mounted again with each
// screen; when the screen changes by a step, the highlight starts from there and glides to the new step.
let lastMark = null
const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// `counts`: { meropenem, albumin } form counts for the day (useRequestCounts) or null; `chartDone`: the
// chart's «اكتمل» flag when known. A step the current device cannot use offline says so in words.
export function WardStepBar({ steps, current, isOnline, counts, chartDone, onStep }) {
  const trackRef = useRef(null)
  const markRef = useRef(null)
  const itemRefs = useRef([])
  useLayoutEffect(() => {
    const track = trackRef.current
    const mark = markRef.current
    const item = itemRefs.current[current]
    if (!track || !mark || !item) return
    // Bring the current step to the middle of the bar (a phone shows about three of them).
    const trackBox = track.getBoundingClientRect()
    const itemBox = item.getBoundingClientRect()
    track.scrollLeft += (itemBox.left + itemBox.width / 2) - (trackBox.left + trackBox.width / 2)
    // The highlight sits inside the current step (CSS), so it stays under it through badges, rotation and
    // resizing. Only a real step change glides: from the previous spot to this one, as a transform.
    const to = item.getBoundingClientRect()
    if (lastMark && document.body.dataset.stepDir && !reducedMotion() && mark.animate) {
      mark.animate([{ transform: `translateX(${lastMark.left - to.left}px) scaleX(${lastMark.width / to.width})` }, { transform: 'none' }], { duration: 240, easing: 'cubic-bezier(.16, 1, .3, 1)' })
    }
    lastMark = { left: to.left, width: to.width }
  }, [current])
  return <nav className="ward-steps" aria-label="خطوات العمل">
    <div className="ward-steps-track" ref={trackRef}>
      <ol>
        {steps.map((step, index) => {
          const count = step.count && counts?.[step.count] > 0 ? counts[step.count] : 0
          return <li key={step.key} ref={(element) => { itemRefs.current[index] = element }}>
            <button type="button" aria-current={index === current ? 'step' : undefined} onClick={() => index !== current && onStep(step, index > current ? 1 : -1)}>
              <span className="ward-steps-num" aria-hidden="true">{index + 1}</span>
              <span className="ward-steps-label">{step.label}</span>
              {step.key === 'chart' && chartDone && <span className="card-status card-status--done">اكتمل</span>}
              {count > 0 && <span className="card-status card-status--partial">{formsWord(count)}</span>}
              {!isOnline && step.needsConnection && <span className="card-status card-status--muted">يتطلب اتصالاً</span>}
            </button>
            {index === current && <span className="ward-steps-mark" ref={markRef} aria-hidden="true" />}
          </li>
        })}
      </ol>
    </div>
  </nav>
}

// The button at the end of a step's page: the next step, or, after the last, back to the ward page.
export function NextStep({ steps, current, onStep, onDone }) {
  const next = steps[current + 1]
  return <div className="ward-steps-next">
    <button type="button" className="primary-button" onClick={() => (next ? onStep(next, 1) : onDone())}>
      <span>{next ? `الخطوة التالية: ${next.label}` : 'العودة لصفحة الردهة'}</span>
      {next && <span aria-hidden="true"><ChevronStart /></span>}
    </button>
  </div>
}
