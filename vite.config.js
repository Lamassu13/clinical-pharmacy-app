import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      // jsPDF's .html() helper (which this app never calls — export renders a
      // pre-built canvas via addImage instead) lazily import()s these three as optional
      // conveniences. None are installed; leaving them external keeps the dynamic import
      // as a runtime-only reference, which jsPDF's own .catch() handles if it's ever hit.
      external: ['dompurify', 'canvg', 'core-js'],
    },
  },
})
