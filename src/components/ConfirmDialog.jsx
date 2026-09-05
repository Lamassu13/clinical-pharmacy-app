// The styled stand-in for window.confirm, which is not screen-reader-friendly, not
// RTL-polished and not stylable. Rendered by every screen: askConfirm() is called from the
// chart, users and medicines screens, and a dialog that a screen forgets to render leaves
// its promise pending forever — the click silently does nothing.
export default function ConfirmDialog({ dialog, onResolve }) {
  if (!dialog) return null
  return <div className="modal-backdrop" onClick={() => onResolve(false)}><div className="medicine-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-message" onClick={(event) => event.stopPropagation()}><p id="confirm-dialog-message">{dialog.message}</p><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => onResolve(false)}>إلغاء</button><button type="button" className="primary-button" autoFocus onClick={() => onResolve(true)}>تأكيد</button></div></div></div>
}
