import { useLayoutEffect, useState } from 'react'

// The column header's suggestion list, replacing the native <datalist>: on iPad that one shows
// in the QuickType bar above the keyboard, and tapping a suggestion there does not reliably
// reach a React-controlled input — the cell kept the half-typed text and the blur commit then
// refused it. This list is ours, so a tap always lands.
//
// Positioned inside .chart-frame (position: relative) from the input's box, so the header's own
// horizontal scroller never clips it. Options cancel pointerdown so the input keeps focus — a blur
// would commit the partial text before the pick.
//
// `options` are { key, primary, secondary? }: primary is what a pick writes, secondary an optional
// second line (the pill form shows the other language there). Also used by the pill form's spare
// «علاج إضافي» rows, with that patient's card as the frame.
export default function MedicineSuggest({ input, frameRef, scrollerRef, options, highlight, onPick }) {
  const [box, setBox] = useState(null)

  useLayoutEffect(() => {
    const frame = frameRef.current
    const scroller = scrollerRef.current
    if (!input || !frame) return undefined
    const place = () => {
      const inputBox = input.getBoundingClientRect()
      const frameBox = frame.getBoundingClientRect()
      const width = Math.min(300, frameBox.width - 16)
      // RTL: line the list's right edge up with the cell's, kept inside the frame.
      const right = Math.min(Math.max(frameBox.right - inputBox.right, 8), frameBox.width - width - 8)
      setBox({ top: inputBox.bottom - frameBox.top + 4, right, width })
    }
    place()
    scroller?.addEventListener('scroll', place)
    window.addEventListener('resize', place)
    return () => { scroller?.removeEventListener('scroll', place); window.removeEventListener('resize', place) }
  }, [input, frameRef, scrollerRef])

  if (!box || !options.length) return null
  const cancel = (event) => event.preventDefault()
  return <ul className="medicine-suggest" id="medicine-suggest" role="listbox" aria-label="أدوية مطابقة" style={box}>
    {options.map((option, index) => (
      <li key={option.key} role="option" id={`medicine-suggest-${index}`} aria-selected={index === highlight}>
        <button type="button" tabIndex={-1} onPointerDown={cancel} onMouseDown={cancel} onClick={() => onPick(option)}>
          <bdi dir="auto" className="medicine-suggest-primary">{option.primary}</bdi>
          {option.secondary && <bdi dir="auto" className="medicine-suggest-secondary">{option.secondary}</bdi>}
        </button>
      </li>
    ))}
  </ul>
}
