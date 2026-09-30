import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabaseConfigured } from '../../lib/api.js'
import { useAuth, roleHome } from './authState.js'
import { navigateApp } from '../../hooks/useAppRoute.js'
import { sendPasswordReset } from '../../lib/authPassword.js'
import { AUTH_ERROR, authErrorMessage, normalizeAuthError } from '../../lib/authErrors.js'
import {
  COMMON_FIELDS,
  EMAIL_RE,
  allFieldNames,
  roleFields,
  validateSignup,
} from '../../lib/authFields.js'

function FieldError({ message }) {
  if (!message) return null
  return <p className="form__error" role="alert">{message}</p>
}

const RESET_SENT_MESSAGE =
  'Password reset email sent. Open the link from any tab — it lands back inside the app.'

/**
 * Email prefill from the query string (?email=…). Used when signup
 * detects an already-registered address and hands the user to login or
 * password reset without making them retype it. Only ever an email —
 * passwords never travel through URLs.
 */
function readEmailParam() {
  if (typeof window === 'undefined') return ''
  const { search, hash } = window.location
  const query = search || (hash.includes('?') ? hash.slice(hash.indexOf('?')) : '')
  try {
    return new URLSearchParams(query).get('email') || ''
  } catch {
    return ''
  }
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
  // Prefilled when signup detects an existing account and navigates here
  // with /login?email=… — the user never retypes their address.
  const [email, setEmail] = useState(() => readEmailParam())
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
      setError(authErrorMessage(normalizeAuthError(err, 'login')))
    } finally {
      setBusy(false)
    }
  }

  /** Shared reset request — pure I/O, no state writes, so both the
   *  button handler and the one-shot auto-send effect can use it. */
  const requestPasswordReset = useCallback(async (target) => {
    const { error } = await sendPasswordReset(target)
    if (error) throw error
  }, [])

  const onForgot = useCallback(
    async (overrideEmail) => {
      const target = typeof overrideEmail === 'string' ? overrideEmail : email
      setError('')
      setInfo('')
      if (!target.trim()) {
        setError('Enter your email first, then use forgot password.')
        return
      }
      try {
        await requestPasswordReset(target)
        setInfo(RESET_SENT_MESSAGE)
      } catch (err) {
        setError(authErrorMessage(normalizeAuthError(err, 'reset')))
      }
    },
    [email, requestPasswordReset],
  )

  // ?reset=1 arrives from the signup "Reset password" action: the existing
  // forgot-password flow runs once with the email prefilled. The query is
  // stripped afterwards so a browser Back cannot silently re-send emails.
  const resetRequested = useMemo(() => {
    if (typeof window === 'undefined') return false
    const { search, hash } = window.location
    const query = search || (hash.includes('?') ? hash.slice(hash.indexOf('?')) : '')
    try {
      return new URLSearchParams(query).get('reset') === '1'
    } catch {
      return false
    }
  }, [])
  const autoResetFired = useRef(false)
  useEffect(() => {
    if (busy || loading || !resetRequested || autoResetFired.current) return
    const candidate = readEmailParam()
    if (!candidate.trim() || !EMAIL_RE.test(candidate.trim())) return
    // The email field is already initialised from the same query param,
    // so no state write is needed here — just run the existing flow once
    // and strip the query so Back cannot silently re-send the email.
    autoResetFired.current = true
    window.history.replaceState({}, '', '/login')
    window.dispatchEvent(new PopStateEvent('popstate'))
    requestPasswordReset(candidate).then(
      () => setInfo(RESET_SENT_MESSAGE),
      (err) => setError(authErrorMessage(normalizeAuthError(err, 'reset'))),
    )
  }, [busy, loading, resetRequested, requestPasswordReset])

  return (
    <AuthShell
      eyebrow="CLIRevenue · Login"
      title="Welcome back."
      body="Sign in to reach your console. Your role on the account decides which one opens."
      footer="Lost access to your email? Use forgot password above to recover it."
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

const RESEND_COOLDOWN_SECONDS = 60

export function SignupPage() {
  const { signUp, resendConfirmation, role, isAuthenticated, loading } = useAuth()
  const [step, setStep] = useState(1)
  const [email, setEmail] = useState(() => readEmailParam())
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [accountType, setAccountType] = useState(null)
  const [values, setValues] = useState(EMPTY_VALUES)
  const [attempted, setAttempted] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)
  // null = normal form flow. Once set, the panel becomes the
  // confirmation screen instead of the form continuing.
  const [confirmation, setConfirmation] = useState(null)
  const [resendState, setResendState] = useState({ busy: false, error: '', secondsLeft: 0 })

  useEffect(() => {
    if (confirmation) return undefined
    if (!loading && isAuthenticated && role) {
      const home = roleHome(role)
      if (home) navigateApp(home)
    }
    return undefined
  }, [loading, isAuthenticated, role, confirmation])

  useEffect(() => {
    if (resendState.secondsLeft <= 0) return undefined
    const id = window.setInterval(() => {
      setResendState((s) => ({ ...s, secondsLeft: s.secondsLeft - 1 }))
    }, 1000)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resendState.secondsLeft > 0])

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
    // Fresh step, fresh validation state: no errors until the user acts.
    setAttempted(false)
  }

  function continueToStep2(e) {
    e.preventDefault()
    setAttempted(true)
    setError('')
    if (errorCount === 0) {
      setStep(2)
      // Reveal step 2 with a clean slate — otherwise every empty required
      // profile field screams before the user has typed a character.
      setAttempted(false)
    }
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
        // parked and flush on the first authenticated refresh. The user
        // stays right here — no new tab, no dead end — and returns to this
        // tab after clicking the email link (which opens the app callback
        // and routes into the dashboard).
        setConfirmation({ email: email.trim() })
        setResendState((s) => ({ ...s, secondsLeft: RESEND_COOLDOWN_SECONDS }))
      }
    } catch (err) {
      const kind = normalizeAuthError(err, 'signup')
      if (kind === AUTH_ERROR.EMAIL_ALREADY_REGISTERED) {
        // Tell the user plainly and hand them the two ways forward. Form
        // values (except passwords) stay exactly where they are.
        setConfirmation({
          email: email.trim(),
          existing: true,
        })
      } else {
        setError(authErrorMessage(kind))
      }
    } finally {
      setBusy(false)
    }
  }

  async function onResend() {
    if (resendState.busy || resendState.secondsLeft > 0) return
    setResendState({ busy: true, error: '', secondsLeft: 0 })
    try {
      await resendConfirmation(email.trim())
      setResendState({ busy: false, error: '', secondsLeft: RESEND_COOLDOWN_SECONDS })
    } catch (err) {
      setResendState({
        busy: false,
        error: authErrorMessage(normalizeAuthError(err, 'resend')),
        secondsLeft: 0,
      })
    }
  }

  const activeRoleFields = accountType ? roleFields(accountType) : []

  // Confirmation-required and existing-account screens replace the form
  // entirely: no dead ends, and no re-submission of the same form.
  if (confirmation) {
    return (
      <AuthShell
        eyebrow="CLIRevenue · Signup"
        title={confirmation.existing ? 'Email already in use.' : 'Check your email.'}
        body={
          confirmation.existing
            ? 'An account with this email already exists. Log in with your password, or reset it if you have forgotten it.'
            : `We sent a confirmation link to ${confirmation.email}. Open the email, click the link, and return here — this tab stays open and the link lands back inside the app.`
        }
        footer={
          confirmation.existing
            ? 'Passwords are never shown or sent anywhere. Reset only reaches your own account.'
            : 'No account is active until the email is confirmed. Resend if it has not arrived.'
        }
      >
        <p className="confirm__email mono">{confirmation.email}</p>

        {confirmation.existing ? (
            <div className="confirm__actions">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => navigateApp(`/login?email=${encodeURIComponent(confirmation.email)}`)}
              >
                Log in
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() =>
                  navigateApp(`/login?email=${encodeURIComponent(confirmation.email)}&reset=1`)
                }
              >
                Reset password
              </button>
            </div>
          ) : (
            <>
              <div className="confirm__actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={onResend}
                  disabled={resendState.busy || resendState.secondsLeft > 0}
                >
                  {resendState.busy
                    ? 'Sending…'
                    : resendState.secondsLeft > 0
                      ? `Resend available in ${resendState.secondsLeft}s`
                      : 'Resend confirmation email'}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => navigateApp('/login')}
                >
                  Back to login
                </button>
              </div>
              <FieldError message={resendState.error} />
              <p className="form__note">
                Open the confirmation link from any tab — the app completes
                sign-in and opens the right dashboard. Nothing to close
                manually.
              </p>
              <p className="form__note">
                Wrong address? <button type="button" className="adv-link" onClick={() => setConfirmation(null)}>Go back</button>
              </p>
            </>
          )}
      </AuthShell>
    )
  }

  return (
    <AuthShell
      eyebrow="CLIRevenue · Signup"
      title="Create your account."
      body="Two steps: your login, then who you are. Choose Advertiser or Developer — your console follows your role, not a picker."
      footer="Your role is set once at signup and decides which console you can reach."
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

/**
 * Landing target of the signup confirmation (and password-recovery)
 * email links. Supabase detects the `?code=…` PKCE param and exchanges
 * it for a session during client init; this page then routes the user
 * by their server-side profile role. No manual token parsing, no
 * second auth system, no URL/localStorage role.
 */
export function AuthCallbackPage() {
  const { loading, isAuthenticated, role, error: authError, refresh } = useAuth()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!loading) return
    // No session after a generous settle window means the exchange did
    // not complete (expired/used link, or the code was already consumed
    // in another tab). Surface the human error state, not a blank page.
    const id = window.setTimeout(() => {
      if (!supabaseConfigured) setFailed(true)
      else refresh().catch(() => setFailed(true))
    }, 4000)
    return () => window.clearTimeout(id)
  }, [loading, refresh])

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      const id = window.setTimeout(() => setFailed(true), 1500)
      return () => window.clearTimeout(id)
    }
    return undefined
  }, [loading, isAuthenticated])

  if (!failed && (loading || !isAuthenticated)) {
    return (
      <section className="adv-shell" aria-label="Confirming your email">
        <div className="adv-shell__inner adv-shell__inner--narrow">
          <p className="eyebrow eyebrow--plain">CLIRevenue · Email confirmation</p>
          <h2 className="block__title">Confirming your email…</h2>
          <p className="block__body">
            One moment while your session is established.
          </p>
        </div>
      </section>
    )
  }

  if (failed || (!loading && !isAuthenticated) || authError) {
    return (
      <section className="adv-shell" aria-label="Confirmation problem">
        <div className="adv-shell__inner adv-shell__inner--narrow">
          <p className="eyebrow eyebrow--plain">CLIRevenue · Email confirmation</p>
          <h2 className="block__title">Email confirmation could not be completed.</h2>
          <p className="block__body">
            The link may have expired or already been used. Request a new
            email by signing in, or try again.
          </p>
          <div className="confirm__actions">
            <button type="button" className="btn btn--primary" onClick={() => navigateApp('/login')}>
              Return to login
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setFailed(false)
                refresh()
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </section>
    )
  }

  if (role) {
    return (
      <section className="adv-shell" aria-label="Email confirmed">
        <div className="adv-shell__inner adv-shell__inner--narrow">
          <p className="eyebrow eyebrow--plain">CLIRevenue · Email confirmed</p>
          <h2 className="block__title">Your account is ready.</h2>
          <p className="block__body">Opening your dashboard…</p>
        </div>
      </section>
    )
  }

  return (
    <section className="adv-shell" aria-label="Email confirmed">
      <div className="adv-shell__inner adv-shell__inner--narrow">
        <p className="eyebrow eyebrow--plain">CLIRevenue · Email confirmed</p>
        <h2 className="block__title">Your account is ready.</h2>
        <p className="block__body">Resolving your role…</p>
      </div>
    </section>
  )
}
