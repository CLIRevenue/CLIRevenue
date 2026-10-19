import { useEffect, useRef, useState } from 'react'
import { QUERY_CATEGORIES, createQuery } from '../../lib/advertiserQueries.js'

/**
 * "Contact support" — the advertiser's way of asking a person a question.
 *
 * It lands in advertiser_queries, and everything the user types here is
 * shown back to them verbatim when an admin answers, which is why the
 * fields are plain text and the copy says what happens to them. Screenshots
 * are accepted and their names are recorded against the request; the bytes
 * are uploaded through the object-storage handshake, which is deliberately
 * not faked here — a path recorded for a file that was never uploaded
 * would show an admin a broken image and tell them the request is broken
 * too.
 */

const EMPTY = {
  email: '',
  phone: '',
  subject: '',
  body: '',
  category: 'general',
}

export default function SupportDialog({ onClose, onSent, userEmail, companyName }) {
  const [form, setForm] = useState(() => ({ ...EMPTY, email: userEmail || '', company: companyName || '' }))
  const [files, setFiles] = useState([])
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }))

  function addFiles(event) {
    const picked = Array.from(event.target.files || [])
    // Screenshots are diagnostics. Ten is already more than anyone sends.
    setFiles((current) => [...current, ...picked].slice(0, 10))
    if (event.target) event.target.value = ''
  }

  function removeFile(index) {
    setFiles((current) => current.filter((_, i) => i !== index))
  }

  async function onSubmit(event) {
    event.preventDefault()
    const found = {}
    if (!form.subject.trim()) found.subject = 'Give the request a subject.'
    if (form.body.trim().length < 10) found.body = 'A sentence or two more helps us answer.'
    if (form.phone && form.phone.replace(/[^\d]/g, '').length < 7) found.phone = 'That does not look like a number.'
    setErrors(found)
    if (Object.keys(found).length) return

    setSaving(true)
    try {
      const created = await createQuery({
        ...form,
        screenshots: files.map((f) => f.name),
      })
      setForm({ ...EMPTY, email: form.email, company: form.company })
      setFiles([])
      onSent?.(created)
    } catch (err) {
      setErrors({ form: err.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="adv-settings__scrim" role="dialog" aria-modal="true" aria-label="Contact support" onClick={onClose}>
      <div className="adv-settings adv-support" onClick={(event) => event.stopPropagation()}>
        <div className="adv-settings__head">
          <div>
            <h2 className="adv-settings__title">Contact support</h2>
            <p className="adv-settings__sub">A person reads these. The more you give, the faster the answer.</p>
          </div>
          <button type="button" className="adv-settings__close" onClick={onClose} aria-label="Close">
            <svg className="adv-settings__close-mark" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <form className="adv-settings__body adv-support__form" onSubmit={onSubmit} noValidate>
          {errors.form ? <p className="form__error" role="alert">{errors.form}</p> : null}

          <div className="adv-grid adv-grid--2">
            <label className="adv-field">
              <span className="adv-field__label">Email</span>
              <input className="adv-input" type="email" value={form.email} onChange={set('email')} placeholder="you@company.com" />
            </label>
            <label className="adv-field">
              <span className="adv-field__label">Phone <span className="adv-field__opt">optional</span></span>
              <input className="adv-input" type="tel" value={form.phone} onChange={set('phone')} placeholder="+1 555 0100" />
            </label>
          </div>

          <label className="adv-field">
            <span className="adv-field__label">What is this about</span>
            <select className="adv-input" value={form.category} onChange={set('category')}>
              {QUERY_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </label>

          <label className="adv-field">
            <span className="adv-field__label">Subject</span>
            <input className="adv-input" value={form.subject} onChange={set('subject')} placeholder="One line that says what you need" />
            {errors.subject ? <span className="form__error">{errors.subject}</span> : null}
          </label>

          <label className="adv-field">
            <span className="adv-field__label">Message</span>
            <textarea className="adv-input adv-textarea" rows={5} value={form.body} onChange={set('body')} placeholder="What you expected, what happened instead, and anything you have already tried." />
            {errors.body ? <span className="form__error">{errors.body}</span> : null}
          </label>

          <div className="adv-field">
            <span className="adv-field__label">Screenshots <span className="adv-field__opt">optional, up to 10</span></span>
            <input ref={fileRef} className="adv-input" type="file" accept="image/*" multiple onChange={addFiles} />
            {files.length ? (
              <ul className="adv-support__files">
                {files.map((file, i) => (
                  <li key={`${file.name}-${i}`} className="adv-support__file">
                    <span className="adv-support__file-name">{file.name}</span>
                    <span className="adv-support__file-size mono">{Math.round(file.size / 1024)} kB</span>
                    <button type="button" className="adv-support__file-x" onClick={() => removeFile(i)} aria-label={`Remove ${file.name}`}>×</button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="adv-modal__foot">
            <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? 'Sending…' : 'Send to support'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
