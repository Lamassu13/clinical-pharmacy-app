import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // The ward devices are mixed — older iPads (iPadOS 14/15) and Android tablets included — so
    // don't take Vite's default (Safari 16.4 / Chrome 111): lower the syntax to what they run.
    target: ['es2020', 'safari14', 'chrome87', 'firefox78', 'edge88'],
    cssTarget: ['safari14', 'chrome87', 'firefox78', 'edge88'],
    rolldownOptions: {
      // jsPDF's .html() helper (which this app never calls — export renders a
      // pre-built canvas via addImage instead) lazily import()s these three as optional
      // conveniences. None are installed; leaving them external keeps the dynamic import
      // as a runtime-only reference, which jsPDF's own .catch() handles if it's ever hit.
      external: ['dompurify', 'canvg', 'core-js'],
    },
  },
})
