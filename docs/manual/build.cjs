// Builds docs/manual/clinical-pharmacy-manual-ar.pdf from manual.html with the pre-installed Chromium:
//   node docs/manual/build.cjs
// Two passes over the body: the first finds the page each chapter starts on (an invisible marker in
// its heading, read back with pdftotext), the second prints the contents with those page numbers.
// The cover is printed on its own, without the page footer, and put in front (pypdf).
const { chromium } = require('playwright')
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const dir = __dirname
const out = path.join(dir, 'clinical-pharmacy-manual-ar.pdf')
const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'manual-'))
const font = (subset) => fs.readFileSync(path.join(dir, `../../node_modules/@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-${subset}-400-normal.woff2`)).toString('base64')

// Chromium draws the footer apart from the page, so it carries its own font.
const footer = `<style>
  @font-face { font-family: Plex; src: url(data:font/woff2;base64,${font('arabic')}) format('woff2'); }
  @font-face { font-family: Plex; src: url(data:font/woff2;base64,${font('latin')}) format('woff2'); unicode-range: U+0000-00FF; }
</style>
<div dir="rtl" style="width:100%; margin:0 15mm; display:flex; justify-content:space-between; font-family:Plex, 'DejaVu Sans'; font-size:8pt; color:#4f6b63; border-top:0.3mm solid #dbe6df; padding-top:1.5mm;">
  <span>دليل استخدام التطبيق — وحدة الصيدلة السريرية</span>
  <span>صفحة <span class="pageNumber"></span> من <span class="totalPages"></span></span>
</div>`

const pageOf = (pdf) => {
  const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [pdf]).toString())[1])
  const found = {}
  for (let page = 1; page <= pages; page += 1) {
    const text = execFileSync('pdftotext', ['-f', String(page), '-l', String(page), pdf, '-']).toString()
    for (const match of text.matchAll(/QQmk(\d+)QQ/g)) found[match[1]] ??= page
  }
  return found
}

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto(`file://${path.join(dir, 'manual.html')}`)
  await page.evaluate(() => document.fonts.ready)
  // Contents: one line per chapter, a marker in each chapter heading.
  await page.evaluate(() => {
    const list = document.querySelector('.toc-list')
    document.querySelectorAll('.chapter').forEach((chapter, index) => {
      const n = index + 1
      chapter.querySelector('h1').insertAdjacentHTML('beforeend', `<span class="mk">QQmk${n}QQ</span>`)
      list.insertAdjacentHTML('beforeend', `<li><span class="t-num">${n}</span><span class="t-title">${chapter.dataset.title}</span><span class="t-page" data-n="${n}">00</span></li>`)
    })
  })
  const printBody = (file) => page.pdf({ path: file, format: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: footer })

  await page.addStyleTag({ content: '#cover { display: none !important; }' })
  const first = path.join(tmp, 'body1.pdf')
  await printBody(first)
  const pages = pageOf(first)
  await page.evaluate((found) => document.querySelectorAll('.t-page').forEach((cell) => { cell.textContent = found[cell.dataset.n] ?? '' }), pages)
  const body = path.join(tmp, 'body.pdf')
  await printBody(body)
  const check = pageOf(body)
  if (JSON.stringify(check) !== JSON.stringify(pages)) throw new Error(`contents moved between passes: ${JSON.stringify(pages)} → ${JSON.stringify(check)}`)

  await page.addStyleTag({ content: '#cover { display: flex !important; } #toc, .chapter { display: none !important; }' })
  const cover = path.join(tmp, 'cover.pdf')
  await page.pdf({ path: cover, format: 'A4', printBackground: true, preferCSSPageSize: true })
  await browser.close()

  execFileSync('python3', ['-I', '-c', `
import sys
from pypdf import PdfReader, PdfWriter
w = PdfWriter()
for f in sys.argv[1:3]:
    for p in PdfReader(f).pages: w.add_page(p)
w.add_metadata({'/Title': 'دليل استخدام التطبيق — وحدة الصيدلة السريرية', '/Author': 'وحدة الصيدلة السريرية — مستشفى بغداد التعليمي', '/Subject': 'دليل المستخدم', '/Lang': 'ar'})
w.write(sys.argv[3])
`, cover, body, out])
  fs.rmSync(tmp, { recursive: true, force: true })
  console.log(`${out}\nchapters start on body pages: ${JSON.stringify(pages)}`)
})().catch((error) => { console.error(error); process.exit(1) })
