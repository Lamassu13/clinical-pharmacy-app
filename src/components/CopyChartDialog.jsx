// Shown before "نسخ إلى اليوم التالي" actually copies anything — a real three-way choice
// (cancel / copy everything / copy only the medicine list), not the yes/no ConfirmDialog used
// everywhere else in the app. Same modal chrome and keyboard handling as ConfirmDialog, sized
// for one extra button.
export default function CopyChartDialog({ dialog, onResolve }) {
  if (!dialog) return null
  return <div className="modal-backdrop" onClick={() => onResolve(null)}>
    <div className="medicine-modal" role="alertdialog" aria-modal="true" aria-labelledby="copy-dialog-message"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); onResolve(null); return }
        if (event.key !== 'Tab') return
        const f = event.currentTarget.querySelectorAll('button')
        const edge = event.shiftKey ? f[0] : f[f.length - 1]
        if (document.activeElement === edge) { event.preventDefault(); (event.shiftKey ? f[f.length - 1] : f[0]).focus() }
      }}>
      <p id="copy-dialog-message">{dialog.message}</p>
      <div className="modal-actions modal-actions-copy">
        <button type="button" className="secondary-button" autoFocus onClick={() => onResolve(null)}>إلغاء</button>
        <button type="button" className="secondary-button" onClick={() => onResolve('medicines')}>أسماء الأدوية فقط</button>
        <button type="button" className={dialog.danger ? 'danger-button' : 'primary-button'} onClick={() => onResolve('all')}>نسخ الجارت كله</button>
      </div>
    </div>
  </div>
}
