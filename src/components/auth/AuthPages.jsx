import { useEffect, useMemo, useState } from 'react'
import { useAuth, roleHome } from './authState.js'
import { navigateApp } from '../../hooks/useAppRoute.js'
import { sendPasswordReset } from '../../lib/authPassword.js'
import {
  COMMON_FIELDS,
  allFieldNames,
  roleFields,
  validateSignup,
} from '../../lib/authFields.js'

function FieldError({ message }) {
  if (!message) return null
  return <p className="form__error" role="alert">{message}</p>
}

function TextField({ label, name, value, onChange, required, autoComplete, type = 'text', inputMode, placeholder, area = false, min }) {
  const props = {
    className: 'field__input',
    name,
    value,
    onChange,
    autoComplete,
    type,
    inputMode,
    placeholder,
    min,
  }
  return (
    <label className="field">
      <span className="field__label">
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </span>
      {area ? (
        <textarea className="field__input field__input--area" rows={3} {...props} />
      ) : (
        <input {...props} />
      )}
    </label>
  )
}

function PasswordField({ label, value, onChange, name, autoComplete }) {
  const [show, setShow] = useState(false)
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <span className="adv-password">
        <input
          className="field__input"
          type={show ? 'text' : 'password'}
          name={name}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
        />
        <button
          type="button"
          className="btn btn--ghost adv-password__btn"
          onClick={() => setShow((s) => !s)}
          aria-pressed={show}
        >
          {show ? 'Hide' : 'Show'}
        </button>
      </span>
    </label>
  )
}

export function AuthShell({ eyebrow, title, body, children, footer, backHref = '/' }) {
  // One product: reuse adv-shell/panel/form/button primitives.
  return (
    <section className="adv-shell" aria-label={title}>
      <div className="adv-shell__inner adv-shell__inner--narrow">
        <p className="form__note"><button type="button" className="adv-link" onClick={() => navigateApp(backHref)}>← Back to site</button></p>
        <p className="eyebrow eyebrow--plain">{eyebrow}</p>
        <h2 className="block__title">{title}</h2>
        {body ? <p className="block__body">{body}</p> : null}
        <div className="panel adv-panel">{children}</div>
        {footer ? <p className="form__note">{footer}</p> : null}
      </div>
    </section>
  )
}

export function LoginPage() {
  const { signIn, role, isAuthenticated, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  // No chooser screen: an already-signed-in user with a known role leaves login immediately.
  useEffect(() => {
    if (!loading && isAuthenticated && role) {
      const home = roleHome(role)
      if (home) navigateApp(home)
    }
  }, [loading, isAuthenticated, role])

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    setInfo('')
    if (!email.trim() || !password) {
      setError('Email and password are required.')
      return
    }
    setBusy(true)
    try {
      await signIn(email.trim(), password)
      // role resolution happens in provider refresh; redirect via effect on next render.
    } catch (err) {
      setError(err.message || 'Sign in failed.')
    } finally {
      setBusy(false)
    }
  }

  async function onForgot() {
    setError('')
    setInfo('')
    if (!email.trim()) {
      setError('Enter your email first, then use forgot password.')
      return
    }
    try {
      const { error } = await sendPasswordReset(email)
      if (error) throw error
      setInfo('Password reset email sent if this project has email templates enabled.')
    } catch (err) {
      setError(err.message || 'Could not send reset email.')
    }
  }

  return (
    <AuthShell
      eyebrow="CLIRevenue · Login"
      title="Welcome back."
      body="Sign in with Supabase Auth. Your dashboard is chosen by public.profiles.role — never by a manual picker."
      footer="Forgot-password email reset is available if Supabase Auth email templates are enabled for this project."
    >
      <form className="form adv-form" onSubmit={onSubmit} noValidate>
        <label className="field">
          <span className="field__label">Email</span>
          <input className="field__input" type="email" name="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" />
        </label>
        <PasswordField label="Password" name="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        <FieldError message={error} />
        {info ? <div className="adv-notice" role="status">{info}</div> : null}
        <button className="btn btn--primary" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Log in'}
        </button>
        <p className="form__note">
          <button type="button" className="adv-link" onClick={onForgot}>Forgot password?</button>
        </p>
        <p className="form__note">
          No account? <button type="button" className="adv-link" onClick={() => navigateApp('/signup')}>Create one</button>
        </p>
      </form>
    </AuthShell>
  )
}

const EMPTY_VALUES = Object.fromEntries(allFieldNames().map((n) => [n, '']))

export function SignupPage() {
  const { signUp, role, isAuthenticated, loading } = useAuth()
  const [step, setStep] = useState(1)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [accountType, setAccountType] = useState(null)
  const [values, setValues] = useState(EMPTY_VALUES)
  const [attempted, setAttempted] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!loading && isAuthenticated && role) {
      const home = roleHome(role)
      if (home) navigateApp(home)
    }
  }, [loading, isAuthenticated, role])

  // Errors are DERIVED from live values on every render — never stored — so
  // correcting an input removes its error (and any disabled state) on the
  // very next render. `attempted` only controls when messages first appear.
  const errors = useMemo(
    () => (attempted ? validateSignup({ step, email, password, confirm, role: accountType, values }) : {}),
    [attempted, step, email, password, confirm, accountType, values],
  )
  const errorCount = Object.keys(errors).length

  function setValue(name, v) {
    setValues((s) => ({ ...s, [name]: v }))
  }

  function goStep1(e) {
    e.preventDefault()
    setStep(1)
  }

  function continueToStep2(e) {
    e.preventDefault()
    setAttempted(true)
    setError('')
    if (errorCount === 0) setStep(2)
  }

  async function onSubmit(e) {
    e.preventDefault()
    setAttempted(true)
    setError('')
    setInfo('')
    if (errorCount > 0) return
    setBusy(true)
    try {
      const data = await signUp({ email: email.trim(), password, role: accountType, values })
      if (data.session) {
        // Session present: provider refresh resolves role, flushes profile
        // fields, and the effect redirects.
        setInfo('Account created. Opening your dashboard…')
      } else {
        // Email confirmation required: no session yet. Profile fields are
        // parked and flush on the first authenticated refresh.
        setInfo('Check your email to confirm, then log in. Your profile details are saved and applied then.')
      }
    } catch (err) {
      setError(err.message || 'Signup failed.')
    } finally {
      setBusy(false)
    }
  }

  const activeRoleFields = accountType ? roleFields(accountType) : []

  return (
    <AuthShell
      eyebrow="CLIRevenue · Signup"
      title="Create your account."
      body="Advertiser and Developer are the only public options. Admin is never offered here. Your dashboard is assigned by the role stored on your profile."
      footer="Profiles are created through RLS-safe trigger/RPC paths only. No service-role key is used in the browser."
    >
      <form className="form adv-form" onSubmit={onSubmit} noValidate>
        <p className="form__note" aria-hidden="true">
          {step === 1 ? 'Step 1 of 2 — credentials' : 'Step 2 of 2 — profile'}
        </p>

        {/* Step 1 fields stay mounted (hidden, not unmounted) on step 2 so
            password managers and controlled state never lose the password. */}
        <div hidden={step !== 1}>
          <label className="field">
            <span className="field__label">Email <span aria-hidden="true">*</span></span>
            <input className="field__input" type="email" name="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" />
            <FieldError message={errors.email} />
          </label>
          <PasswordField label="Password *" name="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          <FieldError message={errors.password} />
          <PasswordField label="Confirm password *" name="confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          <FieldError message={errors.confirm} />
          <button className="btn btn--primary" type="button" onClick={continueToStep2} disabled={busy}>
            Continue
          </button>
        </div>

        <div hidden={step !== 2}>
          <div className="field" role="group" aria-label="Account type">
            <span className="field__label">Account type <span aria-hidden="true">*</span></span>
            <div className="adv-radio-row">
              <label className="adv-check">
                <input type="radio" name="accountType" value="advertiser" checked={accountType === 'advertiser'} onChange={() => setAccountType('advertiser')} />
                <span>Advertiser</span>
              </label>
              <label className="adv-check">
                <input type="radio" name="accountType" value="developer" checked={accountType === 'developer'} onChange={() => setAccountType('developer')} />
                <span>Developer</span>
              </label>
            </div>
            <FieldError message={errors.role} />
          </div>

          {accountType ? (
            <>
              <p className="form__note">Required fields are marked *. Everything else is optional.</p>

              <p className="eyebrow eyebrow--plain">Profile</p>
              {COMMON_FIELDS.map((f) => (
                <TextField
                  key={f.name}
                  label={f.label}
                  name={f.name}
                  value={values[f.name]}
                  onChange={(e) => setValue(f.name, e.target.value)}
                  required={f.required}
                  autoComplete={f.autoComplete}
                  type={f.type}
                  inputMode={f.inputMode}
                  placeholder={f.placeholder}
                />
              ))}
              <FieldError message={COMMON_FIELDS.filter((f) => f.required).map((f) => errors[f.name]).find(Boolean)} />

              <p className="eyebrow eyebrow--plain">{accountType === 'advertiser' ? 'Company' : 'Developer'}</p>
              {activeRoleFields.map((f) => (
                <TextField
                  key={f.name}
                  label={f.label}
                  name={f.name}
                  value={values[f.name]}
                  onChange={(e) => setValue(f.name, e.target.value)}
                  required={f.required}
                  autoComplete={f.autoComplete}
                  type={f.type}
                  inputMode={f.inputMode}
                  placeholder={f.placeholder}
                  area={f.area}
                  min={f.min}
                />
              ))}
              <FieldError message={activeRoleFields.map((f) => errors[f.name]).find(Boolean)} />
            </>
          ) : (
            <p className="form__note">Pick Advertiser or Developer to show the profile fields.</p>
          )}

          <FieldError message={error} />
          {info ? <div className="adv-notice" role="status">{info}</div> : null}
          <button className="btn btn--primary" type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Sign up'}
          </button>
          <button className="btn btn--ghost" type="button" onClick={goStep1} disabled={busy}>
            Back
          </button>
        </div>

        <p className="form__note">
          Have an account? <button type="button" className="adv-link" onClick={() => navigateApp('/login')}>Log in</button>
        </p>
      </form>
    </AuthShell>
  )
}
