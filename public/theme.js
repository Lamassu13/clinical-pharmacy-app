// Applies the saved dark theme before first paint. A file, not an inline <script>: the
// production Content-Security-Policy (helmet's default script-src 'self') blocks inline scripts.
try {
  if (localStorage.getItem('cpa-theme') === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark')
    // The phone's status bar / browser chrome follows the theme too (the dark surface, not the light brand green).
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#161f1b')
  }
} catch { /* storage unavailable */ }

// iPhone/iPad: a request sheet's blank keeps the sheet's own size (11px on a phone, 13px on an iPad, like the paper it
// copies) instead of 16px, so iOS would zoom the page in when it is tapped. maximum-scale=1 stops that zoom; it is set
// only from the touch on such a blank until it loses focus, because the installed home-screen app honours it for pinch
// too, and pinch-zoom must keep working everywhere else (the chart grid). Not on Android: it never zooms on focus.
try {
  if (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    const viewport = document.querySelector('meta[name="viewport"]')
    const normal = viewport?.getAttribute('content')
    if (viewport && normal) {
      const release = () => { if (!document.activeElement?.classList?.contains('req-input')) viewport.setAttribute('content', normal) }
      document.addEventListener('touchstart', (event) => {
        // The whole field: a tap on its label or unit focuses the blank too (it is one <label>).
        if (!event.target.closest?.('.req-field')) return
        // Already zoomed in: the lock would snap the page back to 1x, so leave the user's zoom alone.
        if (window.visualViewport && window.visualViewport.scale > 1.01) return
        viewport.setAttribute('content', `${normal}, maximum-scale=1`)
        setTimeout(release, 1000) // a touch that scrolled instead of opening the blank gives pinch back
      }, { capture: true, passive: true })
      document.addEventListener('focusout', () => { setTimeout(release, 0) }, true)
    }
  }
} catch { /* leave the default viewport */ }
