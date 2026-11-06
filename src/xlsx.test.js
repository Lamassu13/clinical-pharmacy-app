import test from 'node:test'
import assert from 'node:assert/strict'
import { strFromU8, unzipSync } from 'fflate'
import { buildXlsx, columnName } from './xlsx.js'

const columns = [{ key: 'name', header: 'اسم المريض', width: 24 }, { key: 'age', header: 'العمر' }, { key: 'note', header: 'ملاحظة' }]
const files = (rows) => Object.fromEntries(Object.entries(unzipSync(buildXlsx({ sheetName: 'مواقف القسم', columns, rows }))).map(([name, bytes]) => [name, strFromU8(bytes)]))

test('columnName: A..Z, AA, AB', () => {
  assert.deepEqual([0, 1, 25, 26, 27, 701, 702].map(columnName), ['A', 'B', 'Z', 'AA', 'AB', 'ZZ', 'AAA'])
})

test('buildXlsx: the parts of a workbook, right-to-left with a frozen bold header', () => {
  const parts = files([{ name: 'علي', age: 45, note: 'x' }])
  assert.deepEqual(Object.keys(parts).sort(), ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml'])
  const sheet = parts['xl/worksheets/sheet1.xml']
  assert.match(sheet, /<sheetView rightToLeft="1"/)
  assert.match(sheet, /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/)
  assert.match(sheet, /<dimension ref="A1:C2"\/>/)
  assert.match(sheet, /<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">اسم المريض<\/t><\/is><\/c>/)
  assert.match(parts['xl/workbook.xml'], /<sheet name="مواقف القسم" sheetId="1" r:id="rId1"\/>/)
})

test('buildXlsx: numbers stay numbers, text stays text, empty cells are left out', () => {
  const sheet = files([{ name: 'علي', age: 45, note: '' }, { name: 'حسن', age: '3 سنوات', note: null }])['xl/worksheets/sheet1.xml']
  assert.match(sheet, /<c r="B2" s="2"><v>45<\/v><\/c>/)
  assert.match(sheet, /<c r="B3" s="2" t="inlineStr"><is><t xml:space="preserve">3 سنوات<\/t><\/is><\/c>/)
  assert.doesNotMatch(sheet, /r="C2"/)
  assert.doesNotMatch(sheet, /r="C3"/)
})

test('buildXlsx: markup characters are escaped, a leading = is plain text, illegal characters are dropped', () => {
  const sheet = files([{ name: '=SUM(A1) & <b>"x"</b>', age: 1, note: 'a\u0000b\u000bc' }])['xl/worksheets/sheet1.xml']
  assert.match(sheet, /<t xml:space="preserve">=SUM\(A1\) &amp; &lt;b&gt;&quot;x&quot;&lt;\/b&gt;<\/t>/)
  assert.match(sheet, /<t xml:space="preserve">abc<\/t>/)
  assert.doesNotMatch(sheet, /<f>/) // no formula cell anywhere
})

test('buildXlsx: a sheet name is cleaned and cut to 31 characters', () => {
  const zip = unzipSync(buildXlsx({ sheetName: 'a/b:c*d?e[f]g'.padEnd(40, 'x'), columns, rows: [] }))
  const workbook = strFromU8(zip['xl/workbook.xml'])
  const [, name] = workbook.match(/<sheet name="([^"]*)"/)
  assert.ok(name.length <= 31 && !/[\\/?*[\]:]/.test(name))
})
