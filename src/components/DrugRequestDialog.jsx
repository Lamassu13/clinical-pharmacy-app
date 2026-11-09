import { useState } from 'react'
import { DRUG_REQUESTS, cleanField } from '../../shared/drug-requests.js'

// A request form's typed fields in a dialog (shared/drug-requests.js): opened by the patient-entry
// form when the medicine is added (`screen` false: the fields marked screenOnly stay hidden), and by
// the form's own screen to add or correct one. The name and any field marked `required` in the spec
// (Meropenem's sex and age) must be filled to save; the rest can be completed later from the form's screen.
// The server does not enforce it: forms saved before it became required stay editable.
// A tap on the backdrop does not close it (a stray touch would throw the typing away); Escape and the
// cancel button do.
export default function DrugRequestDialog({ kind, initial, screen = false, kicker, title, note, saveLabel = 'حفظ الاستمارة', cancelLabel = 'لاحقًا', onSave, onClose }) {
  const spec = DRUG_REQUESTS[kind]
  const fields = spec.fields.filter((field) => (screen || !field.screenOnly) && !field.noDialog)
  const [name, setName] = useState(initial.name || '')
  // رقم الطبلة: filled from the chart when it has one, typed here when it does not (digits only, as the server keeps it).
  const [patientId, setPatientId] = useState(initial.patientId || '')
  const [values, setValues] = useState(() => Object.fromEntries(spec.fields.map((field) => [field.key, initial.fields?.[field.key] || ''])))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (field, value) => {
    setError('')
    // Numbers are cleaned as typed; free text only on the server (a trailing space mid-word is fine).
    setValues((current) => ({ ...current, [field.key]: field.digits || field.decimal ? cleanField(field, value) : value.slice(0, field.max) }))
  }
  // A field with `showWhen` is asked only while the choice it depends on is made (the reason for «Not indicated»).
  const shown = fields.filter((field) => !field.showWhen || values[field.showWhen.key] === field.showWhen.value)
  const firstEmpty = name ? shown.find((field) => !field.choices && !values[field.key])?.key : null

  const submit = async (event) => {
    event.preventDefault()
    if (busy) return
    if (!name.trim()) { setError('اكتب اسم المريض.'); return }
    const missing = fields.find((field) => field.required && !values[field.key].trim())
    if (missing) {
      setError(`${missing.label} مطلوب — ${missing.choices ? 'اختره' : 'اكتبه'} ثم احفظ.`)
      event.currentTarget.querySelector(`[data-field="${missing.key}"]`)?.focus()
      return
    }
    setBusy(true)
    const result = await onSave({ name: name.trim(), patientId: patientId.replace(/\D/g, '').slice(0, 20), fields: Object.fromEntries(fields.map((field) => [field.key, values[field.key]])) })
    setBusy(false)
    if (!result.ok) setError(result.message)
  }

  return <div className="modal-backdrop">
    <form className="medicine-modal req-dialog" role="dialog" aria-modal="true" aria-labelledby="req-dialog-title" onSubmit={submit} noValidate
      onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onClose() } }}>
      {kicker && <p className="modal-kicker">{kicker}</p>}
      <h2 id="req-dialog-title">{title || spec.label}</h2>
      {note && <p className="req-dialog-note" role="status">{note}</p>}

      <div className="req-dialog-grid">
        <label className="req-dialog-wide"><span>اسم المريض</span>
          <input value={name} maxLength={200} autoComplete="off" autoFocus={!name} onChange={(event) => { setError(''); setName(event.target.value) }} />
        </label>
        <label><span>رقم الطبلة</span>
          <input value={patientId} maxLength={20} autoComplete="off" inputMode="numeric" dir="ltr"
            onChange={(event) => { setError(''); setPatientId(event.target.value.replace(/\D/g, '')) }} />
        </label>
        {shown.map((field) => {
          // A fixed choice (the sex): chips only, no box to type in.
          if (field.choices) return <div key={field.key} className="req-dialog-stack" role="group" aria-label={field.label} aria-required={field.required || undefined} data-field={field.key} tabIndex={-1}>
            <span>{field.label}{field.required && <small> (مطلوب)</small>}</span>
            <div className="req-chips">{field.choices.map((choice) => <button key={choice} type="button" className="req-chip" aria-pressed={values[field.key] === choice} onClick={() => set(field, choice)}>{choice}</button>)}</div>
          </div>
          const input = <input data-field={field.key} aria-required={field.required || undefined} value={values[field.key]} maxLength={field.max} autoComplete="off" autoFocus={firstEmpty === field.key}
            inputMode={field.digits ? 'numeric' : field.decimal ? 'decimal' : undefined}
            dir={field.auto ? 'auto' : field.ltr || field.digits || field.decimal ? 'ltr' : undefined}
            placeholder={field.placeholder} onChange={(event) => set(field, event.target.value)} />
          const chips = field.chips && <div className="req-chips" role="group" aria-label={`${field.label} — اختيار سريع`}>
            {field.chips.map((chip) => <button key={chip} type="button" className="req-chip" aria-pressed={values[field.key] === chip} onClick={() => set(field, chip)}>{chip}</button>)}
          </div>
          const label = <span>{field.label}{field.unit && <small> ({field.unit})</small>}{field.required && <small> (مطلوب)</small>}</span>
          // One quick choice sits beside its box; several go in a row under it.
          if (field.chips?.length > 1) return <div key={field.key} className={`req-dialog-stack${field.wide ? ' req-dialog-wide' : ''}`}><label>{label}{input}</label>{chips}</div>
          return <label key={field.key} className={field.wide ? 'req-dialog-wide' : undefined}>{label}
            {field.chips ? <span className="req-dialog-field">{input}{chips}</span> : input}
          </label>
        })}
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="secondary-button" onClick={onClose}>{cancelLabel}</button>
        <button type="submit" className="primary-button" disabled={busy}>{busy ? 'جارٍ الحفظ…' : saveLabel}</button>
      </div>
    </form>
  </div>
}
