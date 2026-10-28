import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/api.js'
import { useAuth } from '../auth/authState.js'
import './Suggestions.css'

/* ------------------------------------------------------------------ */
/* Role / category configurations. Kept separate per role so developer
   fields are never submitted as advertiser fields and vice-versa.     */
/* ------------------------------------------------------------------ */

const CORE = [
  { key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Your name' },
  { key: 'email', label: 'Email', type: 'email', required: true, placeholder: 'you@example.com' },
  { key: 'subject', label: 'Subject', type: 'text', required: true, placeholder: 'What would you like to tell us?' },
  { key: 'description', label: 'Description', type: 'textarea', required: true, placeholder: 'Describe your suggestion in detail.' },
]

const DEVELOPER_CATEGORIES = [
  {
    key: 'expansion',
    label: 'Expansion / Newer CLI',
    fields: [
      { key: 'cliName', label: 'CLI or integration name', type: 'text', required: true, placeholder: 'e.g. gh, glab, kubectl' },
      { key: 'version', label: 'Version (optional)', type: 'text', placeholder: 'e.g. 2.41.0' },
      { key: 'capability', label: 'Requested capability / integration', type: 'textarea', required: true, placeholder: 'What should the CLI be able to do?' },
    ],
  },
  {
    key: 'broken',
    label: 'Suggestions / Something Broke',
    fields: [
      { key: 'affected', label: 'Affected CLI or integration', type: 'text', placeholder: 'e.g. the CLI integration' },
      { key: 'steps', label: 'Steps to reproduce (optional)', type: 'textarea', placeholder: 'What did you do, and what happened?' },
    ],
  },
  { key: 'general', label: 'General Suggestions', fields: [] },
]

const ADVERTISER_CATEGORIES = [
  { key: 'feature', label: 'Feature Requests', fields: [] },
  {
    key: 'broken',
    label: 'Something Broke',
    fields: [
      { key: 'steps', label: 'Steps to reproduce (optional)', type: 'textarea', placeholder: 'What did you do, and what happened?' },
    ],
  },
  {
    key: 'campaigns',
    label: 'Campaigns & Analytics',
    fields: [
      { key: 'campaignRef', label: 'Campaign reference (optional)', type: 'text', placeholder: 'Campaign id or name' },
    ],
  },
  {
    key: 'wallet',
    label: 'Wallet & Payments',
    fields: [
      { key: 'txnId', label: 'Transaction ID (optional)', type: 'text', placeholder: 'Transaction reference — never card numbers or passwords' },
    ],
  },
  { key: 'general', label: 'General Suggestions', fields: [] },
]

const categoriesFor = (role) => (role === 'developer' ? DEVELOPER_CATEGORIES : ADVERTISER_CATEGORIES)

const configFor = (role, categoryKey) => categoriesFor(role).find((c) => c.key === categoryKey) || categoriesFor(role)[0]

const categoryLabel = (role, categoryKey) => configFor(role, categoryKey).label

function initialData() {
  return { name: '', email: '', subject: '', description: '', category: '' }
}

/* ------------------------------------------------------------------ */
/* Field input                                                        */
/* ------------------------------------------------------------------ */

function Field({ field, value, onChange, error }) {
  const id = `sugg-${field.key}`
  const isTextarea = field.type === 'textarea'
  return (
    <div className="suggestions__field">
      <label className="label" htmlFor={id}>
        {field.label}
        {field.required && <span className="suggestions__required" aria-hidden="true"> &nbsp;required</span>}
      </label>
      {isTextarea ? (
        <textarea
          id={id}
          className={`input suggestions__input${error ? ' suggestions__input--error' : ''}`}
          value={value}
          onChange={(e) => onChange(field.key, e.target.value)}
          placeholder={field.placeholder}
          required={field.required}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={error ? `${id}-error` : undefined}
          rows={4}
        />
      ) : (
        <input
          id={id}
          type={field.type}
          className={`input suggestions__input${error ? ' suggestions__input--error' : ''}`}
          value={value}
          onChange={(e) => onChange(field.key, e.target.value)}
          placeholder={field.placeholder}
          required={field.required}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={error ? `${id}-error` : undefined}
        />
      )}
      {error && <p id={`${id}-error`} className="suggestions__error">{error}</p>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Role-specific form                                                 */
/* ------------------------------------------------------------------ */

function RoleForm({ role, data, onChange, onSubmit, errors, submitting }) {
  const category = data.category || configFor(role, '').key
  const cfg = configFor(role, category)
  const categories = categoriesFor(role)

  const setField = useCallback((key, value) => onChange({ ...data, [key]: value }), [data, onChange])
  const setCategory = useCallback(
    (key) => onChange({ ...data, category: key }),
    [data, onChange],
  )

  return (
    <form onSubmit={onSubmit} className="suggestions__form-inner" aria-labelledby="sugg-heading">
      <h2 id="sugg-heading" className="suggestions__heading">
        {role === 'developer' ? 'Developer suggestions' : 'Advertiser suggestions'}
      </h2>
      <p className="suggestions__lead">
        {role === 'developer'
          ? 'Help shape the CLIRevenue network. Tell us which tools you want supported or what is not working.'
          : 'Help shape the advertising platform. Tell us about features, campaign issues, analytics or payments.'}
      </p>

      <div className="suggestions__field suggestions__field--full">
        <label className="label">Category</label>
        <div className="suggestions__segmented" role="radiogroup" aria-label="Suggestion category">
          {categories.map((c) => (
            <div
              key={c.key}
              role="radio"
              tabindex={0}
              aria-checked={category === c.key}
              className={`suggestions__chip${category === c.key ? ' suggestions__chip--active' : ''}`}
              onClick={() => setCategory(c.key)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setCategory(c.key)
                }
              }}
            >
              {c.label}
            </div>
          ))}
        </div>
        {errors.category && <p className="suggestions__error">{errors.category}</p>}
      </div>

      {[...CORE, ...cfg.fields].map((field) => {
        const value = data[field.key] ?? ''
        const error = errors[field.key]
        return <Field key={field.key} field={field} value={value} onChange={setField} error={error} />
      })}

      <div className="suggestions__actions">
        <button
          type="submit"
          className="btn btn--primary suggestions__submit"
          disabled={submitting}
        >
          {submitting ? 'Sending…' : 'Send suggestion'}
        </button>
      </div>
    </form>
  )
}

/* ------------------------------------------------------------------ */
/* Main                                                               */
/* ------------------------------------------------------------------ */

export default function Suggestions() {
  const { session } = useAuth()
  const userId = session?.user?.id ?? null

  const [role, setRoleState] = useState('developer')
  const [exiting, setExiting] = useState(null)
  const [entering, setEntering] = useState(null)
  const [dir, setDir] = useState('next')

  const [devData, setDevData] = useState(initialData())
  const [advData, setAdvData] = useState(initialData())

  const [devErrors, setDevErrors] = useState({})
  const [advErrors, setAdvErrors] = useState({})
  const [submitError, setSubmitError] = useState(null)
  const [status, setStatus] = useState('idle') // idle | submitting | success | error

  const devRef = useRef(null)
  const advRef = useRef(null)
  const stackRef = useRef(null)

  const statusSubmitting = status === 'submitting'
  const switching = exiting != null || entering != null

  const activeData = role === 'developer' ? devData : advData

  /* Size the stack to the tallest of the two forms so neither is clipped
     during the slide transition. Measured imperatively after paint; an
     inline height is external to React render so it never loops. Measured
     again on a frame so late layout (fonts, conditional fields) is captured. */
  useEffect(() => {
    const measure = () => {
      const stack = stackRef.current
      const dev = devRef.current
      const adv = advRef.current
      if (!stack || !dev || !adv) return
      /* offsetHeight reads the stack's own height because the forms are
         absolutely positioned with inset:0 (they stretch to fill it), so it
         can never grow beyond the current stack height. scrollHeight reports
         the true content height regardless of the constraining box. */
      const nextHeight = Math.max(dev.scrollHeight, adv.scrollHeight, 260)
      stack.style.height = `${nextHeight}px`
    }
    measure()
    const raf = window.requestAnimationFrame(measure)
    return () => window.cancelAnimationFrame(raf)
  }, [role, devData.category, advData.category, exiting, entering])

  /* Announce the active role to assistive technology and move focus to
     the form's first field once the transition settles. preventScroll keeps
     the page from jumping to the form on mount or role switch. */
  useEffect(() => {
    if (switching) return
    const el = role === 'developer' ? devRef.current : advRef.current
    const first = el?.querySelector('input, textarea, button[role="radio"]')
    if (first && typeof first.focus === 'function') first.focus({ preventScroll: true })
  }, [role, switching])

  const switchRole = useCallback((next) => {
    if (switching || role === next) return
    setDir(role === 'developer' ? 'next' : 'prev')
    setExiting(role)
    setEntering(next)
    window.requestAnimationFrame(() => {
      setRoleState(next)
      setExiting(null)
      setEntering(null)
    })
  }, [role, switching])

  const handleChange = useCallback((next) => {
    if (role === 'developer') setDevData(next)
    else setAdvData(next)
  }, [role])

  const validateFields = useCallback((data) => {
    const next = {}
    for (const field of [...CORE, ...configFor(role, data.category).fields]) {
      const value = String(data[field.key] ?? '').trim()
      if (field.required && !value) {
        next[field.key] = 'This field is required.'
      }
      if (field.key === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        next[field.key] = 'Enter a valid email address.'
      }
    }
    return next
  }, [role])

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault()
    if (statusSubmitting || switching) return
    const data = activeData
    const errors = validateFields(data)
    if (Object.keys(errors).length > 0) {
      if (role === 'developer') setDevErrors(errors)
      else setAdvErrors(errors)
      return
    }

    setStatus('submitting')
    setSubmitError(null)

    const cfg = configFor(role, data.category)
    const details = [
      `Category: ${categoryLabel(role, data.category)}`,
      ...cfg.fields.map((f) => {
        const v = String(data[f.key] ?? '').trim()
        return v ? `${f.label}: ${v}` : null
      }).filter(Boolean),
    ].filter(Boolean).join('\n')

    const message = `${data.description}\n\n---\n${details}`

    try {
      const { error } = await supabase.from('contact_submissions').insert({
        name: data.name.trim(),
        email: data.email.trim(),
        subject: data.subject.trim(),
        message,
        category: role,
        user_id: userId,
      })
      if (error) throw error
      setStatus('success')
      if (role === 'developer') {
        setDevData(initialData())
        setDevErrors({})
      } else {
        setAdvData(initialData())
        setAdvErrors({})
      }
    } catch (err) {
      setStatus('error')
      setSubmitError(err.message || 'Could not send your suggestion. Please try again.')
    }
  }, [role, userId, statusSubmitting, switching, activeData, validateFields])

  const result = status === 'success' ? (
    <div className="suggestions__result suggestions__result--success" role="status" aria-live="polite">
      <span aria-hidden="true">✓</span>
      Your suggestion was sent. Thank you.
    </div>
  ) : status === 'error' ? (
    <div className="suggestions__result suggestions__result--error" role="alert" aria-live="assertive">
      {submitError}
    </div>
  ) : null

  const roleLabel = role === 'developer' ? 'Developer suggestions form' : 'Advertiser suggestions form'

  return (
    <div className="suggestions">
      <div className="suggestions__card">
        <div className="suggestions__header">
          <h1 className="suggestions__title">Suggestions</h1>
          <p className="suggestions__subtitle">
            Have an idea, or is something not working? Tell us whether you are
            speaking as a developer or an advertiser.
          </p>
        </div>

        <div className="suggestions__roles" role="tablist" aria-label="Suggestions role">
          <div
            role="tab"
            tabindex={0}
            aria-selected={role === 'developer'}
            data-active={role === 'developer' ? 'true' : undefined}
            className={`suggestions__role${role === 'developer' ? ' suggestions__role--active' : ''}`}
            onClick={() => switchRole('developer')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                switchRole('developer')
              }
            }}
          >
            I&apos;m a Developer
          </div>
          <div
            role="tab"
            tabindex={0}
            aria-selected={role === 'advertiser'}
            data-active={role === 'advertiser' ? 'true' : undefined}
            className={`suggestions__role${role === 'advertiser' ? ' suggestions__role--active' : ''}`}
            onClick={() => switchRole('advertiser')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                switchRole('advertiser')
              }
            }}
          >
            I&apos;m an Advertiser
          </div>
        </div>

        <div className="suggestions__visually-hidden" aria-live="polite">{roleLabel}</div>

        {result}

        <div className="suggestions__stack" ref={stackRef}>
          <section
            ref={devRef}
            className={`suggestions__form${devClass()}`}
            aria-hidden={role !== 'developer' && !switching ? 'true' : undefined}
          >
            <RoleForm
              role="developer"
              data={devData}
              onChange={handleChange}
              onSubmit={handleSubmit}
              errors={devErrors}
              submitting={statusSubmitting}
            />
          </section>
          <section
            ref={advRef}
            className={`suggestions__form${advClass()}`}
            aria-hidden={role !== 'advertiser' && !switching ? 'true' : undefined}
          >
            <RoleForm
              role="advertiser"
              data={advData}
              onChange={handleChange}
              onSubmit={handleSubmit}
              errors={advErrors}
              submitting={statusSubmitting}
            />
          </section>
        </div>
      </div>
    </div>
  )

  function devClass() {
    if (role === 'developer' && entering === null) return ' suggestions__form--active'
    if (exiting === 'developer') return exitingClass('developer')
    if (entering === 'developer') return enteringClass('developer')
    return ' suggestions__form--hidden'
  }

  function advClass() {
    if (role === 'advertiser' && entering === null) return ' suggestions__form--active'
    if (exiting === 'advertiser') return exitingClass('advertiser')
    if (entering === 'advertiser') return enteringClass('advertiser')
    return ' suggestions__form--hidden'
  }

  function exitingClass(which) {
    /* The role being left slides toward the direction of travel. */
    if (which === 'developer') return dir === 'next' ? ' suggestions__form--exit-left' : ' suggestions__form--exit-right'
    return dir === 'next' ? ' suggestions__form--exit-right' : ' suggestions__form--exit-left'
  }

  function enteringClass(which) {
    /* The role being entered comes in from the opposite side. */
    if (which === 'developer') return dir === 'next' ? ' suggestions__form--enter-left' : ' suggestions__form--enter-right'
    return dir === 'next' ? ' suggestions__form--enter-right' : ' suggestions__form--enter-left'
  }
}
