// The styled stand-in for window.confirm. Rendered by every screen: askConfirm() is called
// from the chart, users, medicines and floors screens, and a dialog that a screen forgets to
// render leaves its promise pending forever — the click silently does nothing.
//
// It gates every irreversible action in the app (delete user / medicine / row / announcement,
// purge charts), so: focus opens on «إلغاء», not the confirm; Escape and a backdrop tap both
// cancel; Tab is trapped between the two buttons; and the confirm button turns danger-styled
// when the caller passes { danger: true }. Focus returns to the control that opened it —
// askConfirm captures that, resolveConfirm restores it.
export default function ConfirmDialog({ dialog, onResolve }) {
  if (!dialog) return null
  return <div className="modal-backdrop" onClick={() => onResolve(false)}>
    <div className="medicine-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-message"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); onResolve(false); return }
        if (event.key !== 'Tab') return
        const f = event.currentTarget.querySelectorAll('button')
        const edge = event.shiftKey ? f[0] : f[f.length - 1]
        if (document.activeElement === edge) { event.preventDefault(); (event.shiftKey ? f[f.length - 1] : f[0]).focus() }
      }}>
      <p id="confirm-dialog-message">{dialog.message}</p>
      <div className="modal-actions">
        <button type="button" className="secondary-button" autoFocus onClick={() => onResolve(false)}>إلغاء</button>
        <button type="button" className={dialog.danger ? 'danger-button' : 'primary-button'} onClick={() => onResolve(true)}>تأكيد</button>
      </div>
    </div>
  </div>
}
