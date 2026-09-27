import { useLayoutEffect, useState } from 'react'

// The column header's suggestion list, replacing the native <datalist>: on iPad that one shows
// in the QuickType bar above the keyboard, and tapping a suggestion there does not reliably
// reach a React-controlled input — the cell kept the half-typed text and the blur commit then
// refused it. This list is ours, so a tap always lands.
//
// Positioned inside .chart-frame (position: relative) from the input's box, so the header's own
// horizontal scroller never clips it. Options cancel pointerdown so the input keeps focus — a blur
// would commit the partial text before the pick.
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
    {options.map((name, index) => (
      <li key={name} role="option" id={`medicine-suggest-${index}`} aria-selected={index === highlight}>
        <button type="button" tabIndex={-1} dir="ltr" onPointerDown={cancel} onMouseDown={cancel} onClick={() => onPick(name)}>{name}</button>
      </li>
    ))}
  </ul>
}
