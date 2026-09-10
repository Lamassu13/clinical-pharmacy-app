// Integer → Arabic words for the requisition's "الكمية كتابة" column — a readable spelled-out
// copy of the quantity, not a grammatically case-inflected one. Covers 0..999,999, which is
// far above any real total (a chart cell caps at 4 digits, 41 patients).

const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة',
  'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر']
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون']
const HUNDREDS = ['', 'مئة', 'مئتان', 'ثلاثمئة', 'أربعمئة', 'خمسمئة', 'ستمئة', 'سبعمئة', 'ثمانمئة', 'تسعمئة']

// The ordered word-parts of a 0..999 group (ones before tens, as Arabic reads them).
const groupParts = (n) => {
  const parts = []
  const hundred = Math.floor(n / 100)
  const rest = n % 100
  if (hundred) parts.push(HUNDREDS[hundred])
  if (rest < 20) {
    if (rest) parts.push(ONES[rest])
  } else {
    const one = rest % 10
    if (one) parts.push(ONES[one])
    parts.push(TENS[Math.floor(rest / 10)])
  }
  return parts
}

export const numberToArabicWords = (value) => {
  const n = Math.trunc(Number(value))
  if (!Number.isFinite(n) || n < 0) return ''
  if (n === 0) return 'صفر'
  const thousands = Math.floor(n / 1000)
  const rest = n % 1000
  const parts = []
  if (thousands === 1) parts.push('ألف')
  else if (thousands === 2) parts.push('ألفان')
  else if (thousands >= 3 && thousands <= 10) parts.push(`${groupParts(thousands).join(' و')} آلاف`)
  else if (thousands > 10) parts.push(`${groupParts(thousands).join(' و')} ألفًا`)
  parts.push(...groupParts(rest))
  return parts.join(' و')
}

// node server/arabic-number.js — self-check
if (process.argv[1] && process.argv[1].endsWith('arabic-number.js')) {
  const assert = await import('node:assert/strict')
  const eq = (n, want) => assert.default.equal(numberToArabicWords(n), want, `${n}`)
  eq(0, 'صفر'); eq(1, 'واحد'); eq(2, 'اثنان'); eq(3, 'ثلاثة'); eq(10, 'عشرة'); eq(11, 'أحد عشر')
  eq(20, 'عشرون'); eq(21, 'واحد وعشرون'); eq(48, 'ثمانية وأربعون'); eq(100, 'مئة'); eq(200, 'مئتان')
  eq(215, 'مئتان وخمسة عشر'); eq(1000, 'ألف'); eq(2000, 'ألفان'); eq(2026, 'ألفان وستة وعشرون')
  eq(3000, 'ثلاثة آلاف'); eq(40320, 'أربعون ألفًا وثلاثمئة وعشرون'); eq(-5, ''); eq('x', '')
  console.log('arabic-number self-check ok')
}
