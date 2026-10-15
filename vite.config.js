import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Fills public/sw.js's '__PRECACHE__' / '__BUILD_HASH__' placeholders in the built dist/sw.js
// with every hashed file in dist/assets, so a first visit caches the whole app at install instead
// of only what that visit happened to load. Unfilled (dev, or this plugin skipped), sw.js keeps
// its old cache-on-use behaviour.
const precacheServiceWorker = () => {
  let outDir
  return {
    name: 'precache-service-worker',
    apply: 'build',
    configResolved(config) { outDir = path.resolve(config.root, config.build.outDir) },
    closeBundle() {
      const swPath = path.join(outDir, 'sw.js')
      const assets = readdirSync(path.join(outDir, 'assets')).sort().map((file) => `/assets/${file}`)
      const hash = createHash('sha256').update(assets.join('\n')).digest('hex').slice(0, 10)
      const source = readFileSync(swPath, 'utf8')
      if (!source.includes("'__PRECACHE__'") || !source.includes("'__BUILD_HASH__'")) throw new Error('sw.js precache placeholders not found')
      writeFileSync(swPath, source.replace("'__PRECACHE__'", JSON.stringify(assets)).replace("'__BUILD_HASH__'", JSON.stringify(hash)))
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), precacheServiceWorker()],
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
