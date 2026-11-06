import { strToU8, zipSync } from 'fflate'

// A one-sheet .xlsx (Office Open XML) from a flat table, for the reports' «تصدير Excel». An .xlsx is a
// zip of a few XML parts, so no spreadsheet library is needed. Right-to-left sheet, bold frozen
// header row, wrapped text; a number stays a number (so Excel can sort, filter and count it) and
// any text is an inline string, so a name starting with «=» is text, never a formula.
// columns: [{ key, header, width }]   rows: [{ [key]: string | number | null }]
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
// Characters XML 1.0 cannot carry are dropped (Excel would call the file corrupt).
const ILLEGAL = /[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu
const esc = (value) => String(value).replace(ILLEGAL, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export const columnName = (index) => {
  let n = index + 1
  let name = ''
  while (n > 0) { name = String.fromCharCode(65 + ((n - 1) % 26)) + name; n = Math.floor((n - 1) / 26) }
  return name
}
const text = (ref, style, value) => `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`

export const buildXlsx = ({ sheetName = 'Sheet1', columns, rows }) => {
  const header = `<row r="1">${columns.map((column, index) => text(`${columnName(index)}1`, 1, column.header)).join('')}</row>`
  const body = rows.map((row, rowIndex) => {
    const cells = columns.map((column, index) => {
      const value = row[column.key]
      const ref = `${columnName(index)}${rowIndex + 2}`
      if (value === null || value === undefined || value === '') return ''
      return typeof value === 'number' && Number.isFinite(value) ? `<c r="${ref}" s="2"><v>${value}</v></c>` : text(ref, 2, value)
    }).join('')
    return `<row r="${rowIndex + 2}">${cells}</row>`
  }).join('')
  const last = `${columnName(columns.length - 1)}${rows.length + 1}`
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${NS}"><dimension ref="A1:${last}"/><sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${columns.map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${column.width || 14}" customWidth="1"/>`).join('')}</cols><sheetData>${header}${body}</sheetData></worksheet>`
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${NS}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`
  // A sheet name is at most 31 characters and cannot hold  \ / ? * [ ] :
  const name = esc(sheetName.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Sheet1')
  return zipSync({
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(styles),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  })
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

// Hands the file to the browser as a download. (A tablet's browser keeps it in Downloads / Files.)
export const downloadXlsx = (bytes, fileName) => {
  const url = URL.createObjectURL(new Blob([bytes], { type: XLSX_TYPE }))
  // A browser with no `download` on links (iOS before 13) opens the file instead, as the PDF route does.
  if (!('download' in HTMLAnchorElement.prototype)) { window.location.href = url; return }
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
