import { useCallback, useState } from 'react'

// The header's light/dark toggle. theme.js applies a saved choice before the first paint; this
// keeps the button, the <html data-theme> and the saved choice in step.
export default function useTheme() {
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light')
  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark'
      try { localStorage.setItem('cpa-theme', next) } catch { /* storage unavailable */ }
      if (next === 'dark') document.documentElement.setAttribute('data-theme', 'dark')
      else document.documentElement.removeAttribute('data-theme')
      return next
    })
  }, [])
  return { theme, toggleTheme }
}
