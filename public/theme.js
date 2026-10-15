// Applies the saved dark theme before first paint. A file, not an inline <script>: the
// production Content-Security-Policy (helmet's default script-src 'self') blocks inline scripts.
try { if (localStorage.getItem('cpa-theme') === 'dark') document.documentElement.setAttribute('data-theme', 'dark') } catch { /* storage unavailable */ }
