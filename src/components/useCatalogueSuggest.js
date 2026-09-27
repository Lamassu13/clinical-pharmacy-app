import { useState } from 'react'
import { catalogueMatches } from '../helpers.js'

// Registry suggestions for a free-text medicine field on the pill forms (the spare «علاج إضافي»
// rows of استمارة الحبوب, every row of استمارة الحبوب الإضافي). Matches the English or the Arabic
// name; a pick writes the name these forms show for chart medicines — the Arabic one when the
// medicine has one, English on an English-only (CCU) form. The field stays free text.
//
// `valueOf(key)` reads a field's current text, `write(key, name)` stores a pick. Spread
// `bind(key, cardKey)` onto the <input>, and render <MedicineSuggest {...listProps} /> inside the
// card whose key equals `target.cardKey` (the card is the positioned frame; its table scroller
// would otherwise clip the list).
export default function useCatalogueSuggest({ catalogue, englishOnly = false, valueOf, write }) {
  const [target, setTarget] = useState(null)
  const [highlight, setHighlight] = useState(0)
  const typed = target ? valueOf(target.key) || '' : ''
  const options = target ? catalogueMatches(typed, catalogue).map((entry) => {
    const arabic = englishOnly ? '' : (entry.arabic_name || '').trim()
    return { key: entry.name, primary: arabic || entry.name, secondary: arabic ? entry.name : '' }
  }).filter((option) => option.primary !== typed.trim()) : []
  const active = Math.min(highlight, Math.max(0, options.length - 1))

  const pick = (option) => {
    write(target.key, option.primary)
    target.input.blur()
  }
  const bind = (key, cardKey) => {
    const open = target?.key === key && options.length > 0
    return {
      autoComplete: 'off', autoCorrect: 'off', autoCapitalize: 'off', spellCheck: false,
      role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': open, 'aria-controls': 'medicine-suggest',
      'aria-activedescendant': open ? `medicine-suggest-${active}` : undefined,
      onFocus: (event) => {
        const input = event.target
        setHighlight(0)
        setTarget({ key, cardKey, input, frameRef: { current: input.closest('.pill-form') }, scrollerRef: { current: input.closest('.pill-table-scroll') } })
      },
      onBlur: () => setTarget(null),
      onKeyDown: (event) => {
        if (!open) return
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          const step = event.key === 'ArrowDown' ? 1 : -1
          setHighlight((active + step + options.length) % options.length)
        } else if (event.key === 'Enter') {
          event.preventDefault()
          pick(options[active])
        } else if (event.key === 'Escape') {
          event.preventDefault()
          setTarget(null)
        }
      },
    }
  }
  const listProps = target && { input: target.input, frameRef: target.frameRef, scrollerRef: target.scrollerRef, options, highlight: active, onPick: pick }
  return { target, bind, listProps }
}
