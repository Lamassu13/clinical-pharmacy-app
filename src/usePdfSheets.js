import { useCallback, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

// «طباعة» on the pills forms: the same canvas → PDF route as the chart (exportChartPdf in
// App.jsx), so the paper is identical on every device instead of whatever each browser's print
// engine makes of the live page. `run(sheets, name)` mounts <PillsPrintTemplate ref={ref}
// sheets={sheets}> (the caller renders it while `sheets` is set), draws each .ppt-sheet to a
// canvas, puts one per A4 portrait page in a PDF and opens it in the browser's own viewer.
// ponytail: the chart keeps its own copy of this flow; fold them together if either changes again.
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
      const pages = [...node.querySelectorAll('.ppt-sheet')]
      for (let index = 0; index < pages.length; index += 1) {
        const canvas = await html2canvas(pages[index], { scale: 2, backgroundColor: '#ffffff', onclone: (clonedDoc) => clonedDoc.querySelectorAll('script').forEach((script) => script.remove()) })
        if (index) pdf.addPage()
        // 'FAST' deflates the pixels: jsPDF stores a PNG raw otherwise (~10MB an A4 page at this scale).
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 210, 297, undefined, 'FAST')
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
