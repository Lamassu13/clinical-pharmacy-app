import { chunksToPdf, SHEETS_PER_CANVAS } from './usePdfSheets.js'

// «طباعة» on the reports: A4 portrait pages drawn to a canvas and put in a PDF, the forms' route
// (chunksToPdf), so the paper is the same on every device instead of whatever each browser's print
// engine makes of the live page. A report runs to any length, so the pages are filled here: the
// on-screen report is copied piece by piece (the letterhead, each section's title and note, then
// its content) into fixed-size pages. A table that runs over continues on the next page under its
// own header row; a row is never cut, and a title never ends a page.

const el = (tag, className = '', text = '') => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}
// A section's title, its note, the trend's «الدواء» line and the «… (تابع)» line of a continued
// part: what goes with the first block after it.
const LEAD = '.report-section-head, .report-note, .report-trend-pick, .report-continued'

// A copy for paper: no buttons, and a <select> as the text it shows (a clone keeps the markup, not
// the chosen option).
const paperCopy = (node) => {
  const copy = node.cloneNode(true)
  copy.querySelectorAll('.report-print-one, .report-print-skip').forEach((cell) => cell.remove())
  const selects = node.querySelectorAll('select')
  copy.querySelectorAll('select').forEach((select, index) => select.replaceWith(el('strong', '', selects[index].selectedOptions[0]?.textContent || '')))
  return copy
}

// Fills pages into `root` from the report `article` (only the section `only`, when given). Every
// page's footer carries `title` and a page-number line from the start, so the space measured for
// the content is the space it gets.
const paginate = (article, root, only, title) => {
  const pages = []
  let body
  const newPage = () => {
    const page = el('section', 'report-page')
    body = el('div', 'report-page-body')
    const foot = el('footer', 'report-page-foot')
    foot.append(el('span', '', title), el('span', 'report-page-number', 'صفحة'))
    page.append(body, foot)
    root.append(page)
    pages.push(page)
  }
  const fits = () => body.scrollHeight <= body.clientHeight

  newPage()
  body.append(paperCopy(article.querySelector('.report-doc-head')))
  const sections = [...article.querySelectorAll(':scope > .report-section:not(.is-closed)')].filter((section) => !only || section.dataset.section === only)
  for (const section of sections) {
    let shell = section.cloneNode(false)
    body.append(shell)
    const leadOnly = () => [...shell.children].every((child) => child.matches(LEAD))
    const continueOnNextPage = () => {
      newPage()
      shell = section.cloneNode(false)
      shell.classList.add('is-continued')
      shell.append(el('p', 'report-continued', `${section.querySelector('h2')?.textContent || ''} (تابع)`))
      body.append(shell)
    }
    // `node` did not fit at the foot of this page. With only the section's title and note above
    // it here, the whole section moves on (unless it already starts this page, where moving can't
    // help); otherwise the section continues on the next page.
    const carry = (node) => {
      node.remove()
      const alone = body.children.length === 1 && body.firstChild === shell
      if (leadOnly() && !alone) { shell.remove(); newPage(); body.append(shell) }
      else if (!leadOnly()) continueOnNextPage()
      shell.append(node)
    }
    const placeTable = (frame) => {
      const table = frame.querySelector('table')
      let tbody
      const open = () => {
        const frameCopy = frame.cloneNode(false)
        const tableCopy = table.cloneNode(false)
        tbody = el('tbody')
        if (table.tHead) tableCopy.append(paperCopy(table.tHead))
        tableCopy.append(tbody)
        frameCopy.append(tableCopy)
        shell.append(frameCopy)
        return frameCopy
      }
      let frameCopy = open()
      for (const row of table.tBodies[0]?.rows || []) {
        if (row.dataset.printSkip) continue // a row the reader left unticked
        const copy = paperCopy(row)
        tbody.append(copy)
        if (fits()) continue
        copy.remove()
        // Not one row under the header here: the table (with a title-only section) moves on whole.
        if (!tbody.rows.length) carry(frameCopy)
        else { continueOnNextPage(); frameCopy = open() }
        tbody.append(copy)
      }
    }
    for (const child of section.children) {
      // A title and note are checked together with the first block after them.
      if (child.matches(LEAD) && leadOnly()) { shell.append(paperCopy(child)); continue }
      if (child.matches('.table-frame')) { placeTable(child); continue }
      const copy = paperCopy(child)
      shell.append(copy)
      if (!fits()) carry(copy)
    }
  }
  return pages
}

// `article`: the on-screen .report-doc. `title` goes in every page's footer, `name` is the file's.
export async function exportReportPdf(article, { only = null, title, name }) {
  await document.fonts.ready // the pages are measured as they fill, so the real font must be in
  const root = el('div', 'ppt-root report-pdf')
  document.body.append(root)
  try {
    const pages = paginate(article, root, only, title)
    pages.forEach((page, index) => { page.querySelector('.report-page-number').textContent = `صفحة ${index + 1} من ${pages.length}` })
    for (let index = 0; index < pages.length; index += SHEETS_PER_CANVAS) {
      const chunk = el('div', 'ppt-chunk')
      chunk.append(...pages.slice(index, index + SHEETS_PER_CANVAS))
      root.append(chunk)
    }
    await chunksToPdf(root, name)
  } finally {
    root.remove()
  }
}
