import { useCallback, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

// «طباعة» on the pills forms: the same canvas → PDF route as the chart (exportChartPdf in
// App.jsx), so the paper is identical on every device instead of whatever each browser's print
// engine makes of the live page. `run(sheets, name)` mounts <PillsPrintTemplate ref={ref}
// sheets={sheets}> (the caller renders it while `sheets` is set), draws each .ppt-sheet to a
// canvas, puts one per A4 portrait page in a PDF and opens it in the browser's own viewer.
// ponytail: the chart keeps its own copy of this flow; fold them together if either changes again.
export const SHEETS_PER_CANVAS = 3

export default function usePdfSheets() {
  const [sheets, setSheets] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ref = useRef(null)
  const run = useCallback(async (built, name) => {
    if (busy || !built.length) return
    setBusy(true)
    setError('')
    try {
      flushSync(() => setSheets(built))
      await document.fonts.ready
      const node = ref.current
      await Promise.all([...node.querySelectorAll('img')].map((image) => (image.decode ? image.decode().catch(() => undefined) : undefined)))
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')])
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      // Several sheets per html2canvas call: its per-call cost (cloning and laying out the page)
      // dwarfs the drawing, so 3 sheets take about as long as 1. Capped by the canvas size iPads
      // allow (about 16 million pixels: 3 sheets at this scale is about 10).
      let sheetIndex = 0
      for (const chunk of node.querySelectorAll('.ppt-chunk')) {
        const canvas = await html2canvas(chunk, { scale: 2, backgroundColor: '#ffffff', onclone: (clonedDoc) => clonedDoc.querySelectorAll('script').forEach((script) => script.remove()) })
        const count = chunk.children.length
        const slice = document.createElement('canvas')
        slice.width = canvas.width
        slice.height = Math.round(canvas.height / count)
        for (let part = 0; part < count; part += 1) {
          slice.getContext('2d').drawImage(canvas, 0, -part * slice.height)
          if (sheetIndex) pdf.addPage()
          // JPEG: jsPDF embeds it as is, where a PNG is decoded and deflated again (~200ms a page).
          pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297)
          sheetIndex += 1
        }
      }
      // Navigates the tab, like the chart: window.open is blocked on iOS once the awaits above
      // have run, and the viewer it lands in has the system print / share buttons.
      window.location.href = pdf.output('bloburl', { filename: `${name.replace(/[\\/:*?"<>|]/g, '-')}.pdf` })
    } catch {
      setError('تعذّر إنشاء ملف PDF — حاول مرة أخرى.')
    } finally {
      setSheets(null)
      setBusy(false)
    }
  }, [busy])
  return { sheets, busy, error, ref, run }
}
