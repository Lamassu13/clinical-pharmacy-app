// Applies the saved dark theme before first paint. A file, not an inline <script>: the
// production Content-Security-Policy (helmet's default script-src 'self') blocks inline scripts.
try {
  if (localStorage.getItem('cpa-theme') === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark')
    // The phone's status bar / browser chrome follows the theme too (the dark surface, not the light brand green).
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#161f1b')
  }
} catch { /* storage unavailable */ }
