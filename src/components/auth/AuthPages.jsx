import PageChrome from '../landing/PageChrome.jsx'
import AuthCurve from './AuthCurve.jsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabaseConfigured } from '../../lib/api.js'
import { useAuth, roleHome } from './authState.js'
import { navigateApp } from '../../hooks/useAppRoute.js'
import { sendPasswordReset } from '../../lib/authPassword.js'
import { AUTH_ERROR, authErrorMessage, normalizeAuthError } from '../../lib/authErrors.js'
import {
  CALLBACK_STATE,
  FAILED_LINK_MESSAGE,
  classifyCallback,
  readCallbackParams,
} from './authCallback.js'
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
          aria-label={show ? 'Hide password' : 'Show password'}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {show ? (
              <>
                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                <circle cx="12" cy="12" r="3" />
              </>
            ) : (
              <>
                <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                <line x1="2" x2="22" y1="2" y2="22" />
              </>
            )}
          </svg>
        </button>
      </span>
    </label>
  )
}

export function AuthShell({ eyebrow, title, body, children, footer, backHref = '/', mode = 'login' }) {
  return (
    <PageChrome flat>
      <section className="adv-shell adv-shell--auth" aria-label={title}>
        <AuthCurve mode={mode} />
        <div className="adv-shell__inner adv-shell__inner--narrow">
          <div className="adv-shell__meta">
            <p className="form__note"><button type="button" className="adv-link" onClick={() => navigateApp(backHref)}>← Back to site</button></p>
            <p className="eyebrow eyebrow--plain">{eyebrow}</p>
          </div>
          <h2 className="block__title">{title}</h2>
          {body ? <p className="block__body">{body}</p> : null}
          <div className="panel adv-panel">{children}</div>
          {footer ? <p className="form__note">{footer}</p> : null}
        </div>
      </section>
    </PageChrome>
  )
}

export function LoginPage() {
  const { signIn, role, isAuthenticated, loading } = useAuth()
  const [email, setEmail] = useState(() => readEmailParam())
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

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
    } catch (err) {
      setError(authErrorMessage(normalizeAuthError(err, 'login')))
    } finally {
      setBusy(false)
    }
  }

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
      mode="login"
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
        <button className="btn btn--auth-primary" type="submit" disabled={busy}>
          <span>{busy ? 'Signing in…' : 'Log in'}</span>
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
  const [confirmation, setConfirmation] = useState(null)
  const [resendState, setResendState] = useState({ busy: false, error: '', secondsLeft: 0 })
  const [privacyConsent, setPrivacyConsent] = useState(false)
  const [termsConsent, setTermsConsent] = useState(false)

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
  }, [resendState.secondsLeft > 0])

  const errors = useMemo(
    () => (attempted ? validateSignup({ step, email, password, confirm, role: accountType, values, privacyConsent, termsConsent }) : {}),
    [attempted, step, email, password, confirm, accountType, values, privacyConsent, termsConsent],
  )
  const errorCount = Object.keys(errors).length

  function setValue(name, v) {
    setValues((s) => ({ ...s, [name]: v }))
  }

  function goStep1(e) {
    e.preventDefault()
    setStep(1)
    setAttempted(false)
  }

  function continueToStep2(e) {
    e.preventDefault()
    setAttempted(true)
    setError('')
    if (errorCount === 0) {
      setStep(2)
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
      const data = await signUp({ email: email.trim(), password, role: accountType, values, privacyConsent, termsConsent })
      if (data.session) {
        setInfo('Account created. Opening your dashboard…')
      } else {
        setConfirmation({ email: email.trim() })
        setResendState((s) => ({ ...s, secondsLeft: RESEND_COOLDOWN_SECONDS }))
      }
    } catch (err) {
      const kind = normalizeAuthError(err, 'signup')
      if (kind === AUTH_ERROR.EMAIL_ALREADY_REGISTERED) {
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

  if (confirmation) {
    return (
      <AuthShell
        mode="signup"
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
                className="btn btn--auth-primary"
                onClick={() => navigateApp(`/login?email=${encodeURIComponent(confirmation.email)}`)}
              >
                <span>Log in</span>
              </button>
              <button
                type="button"
                className="btn btn--ghost glass-button glass-button--ghost"
                onClick={() =>
                  navigateApp(`/login?email=${encodeURIComponent(confirmation.email)}&reset=1`)
                }
              >
                <span>Reset password</span>
              </button>
            </div>
          ) : (
            <>
              <div className="confirm__actions">
                <button
                  type="button"
                  className="btn btn--auth-primary"
                  onClick={onResend}
                  disabled={resendState.busy || resendState.secondsLeft > 0}
                >
                  <span>
                    {resendState.busy
                      ? 'Sending…'
                      : resendState.secondsLeft > 0
                        ? `Resend available in ${resendState.secondsLeft}s`
                        : 'Resend confirmation email'}
                  </span>
                </button>
                <button
                  type="button"
                  className="btn btn--ghost glass-button glass-button--ghost"
                  onClick={() => navigateApp('/login')}
                >
                  <span>Back to login</span>
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
      mode="signup"
      eyebrow="CLIRevenue · Signup"
      title="Create your account."
      body="Two steps: your login, then who you are. Choose Advertiser or Developer — your console follows your role, not a picker."
      footer="Your role is set once at signup and decides which console you can reach."
    >
      <form className="form adv-form" onSubmit={onSubmit} noValidate>
        <p className="form__note" aria-hidden="true">
          {step === 1 ? 'Step 1 of 2 — credentials' : 'Step 2 of 2 — profile'}
        </p>

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
          <button className="btn btn--primary glass-button" type="button" onClick={continueToStep2} disabled={busy}>
            <span>Continue</span>
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

          <div className="form__consent">
            <label className="adv-check">
              <input
                type="checkbox"
                checked={privacyConsent}
                onChange={(e) => setPrivacyConsent(e.target.checked)}
              />
              <span>I agree to the <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.</span>
            </label>
            <FieldError message={errors.privacyConsent} />
            <label className="adv-check">
              <input
                type="checkbox"
                checked={termsConsent}
                onChange={(e) => setTermsConsent(e.target.checked)}
              />
              <span>I agree to the <a href="/terms" target="_blank" rel="noopener noreferrer">Terms &amp; Conditions</a>.</span>
            </label>
            <FieldError message={errors.termsConsent} />
          </div>

          <button className="btn btn--auth-primary" type="submit" disabled={busy || !privacyConsent || !termsConsent}>
            <span>{busy ? 'Creating…' : 'Sign up'}</span>
          </button>
          <button className="btn btn--ghost glass-button glass-button--ghost" type="button" onClick={goStep1} disabled={busy}>
            <span>Back</span>
          </button>
        </div>

        <p className="form__note">
          Have an account? <button type="button" className="adv-link" onClick={() => navigateApp('/login')}>Log in</button>
        </p>
      </form>
    </AuthShell>
  )
}

export function AuthCallbackPage() {
  const { loading, isAuthenticated, role, error: authError, refresh } = useAuth()
  const home = roleHome(role)
  const [asyncFailure, setAsyncFailure] = useState(null)

  const params = useMemo(
    () => readCallbackParams(typeof window === 'undefined' ? '' : window.location.href),
    [],
  )
  const urlVerdict = useMemo(() => classifyCallback(params), [params])

  const navigated = useRef(false)

  const immediateFailure =
    params.error || params.errorCode || params.errorDescription
      ? urlVerdict
      : !supabaseConfigured && !loading && !isAuthenticated
        ? {
            state: CALLBACK_STATE.FAILED,
            message: FAILED_LINK_MESSAGE,
            detail: 'Supabase environment variables are missing.',
          }
        : null
  const failure = immediateFailure || asyncFailure

  useEffect(() => {
    if (loading || !isAuthenticated || navigated.current) return
    navigated.current = true
    navigateApp(home || '/app')
  }, [loading, isAuthenticated, home])

  useEffect(() => {
    if (loading || isAuthenticated) return undefined
    if (failure) return undefined
    const id = window.setTimeout(() => {
      refresh().catch(() =>
        setAsyncFailure({ state: CALLBACK_STATE.FAILED, message: FAILED_LINK_MESSAGE, detail: '' }),
      )
    }, 4000)
    return () => window.clearTimeout(id)
  }, [loading, isAuthenticated, failure, refresh])

  if (failure) {
    const verdict = failure
    return (
      <section className="adv-shell adv-shell--callback" aria-label="Confirmation problem">
        <div className="adv-shell__inner adv-shell__inner--narrow">
          <p className="eyebrow eyebrow--plain">CLIRevenue · Email confirmation</p>
          <h2 className="block__title">
            {verdict.state === CALLBACK_STATE.EXPIRED
              ? 'That confirmation link has expired.'
              : 'Email confirmation could not be completed.'}
          </h2>
          <p className="block__body">{verdict.message}</p>
          <div className="confirm__actions">
            <button type="button" className="btn btn--auth-primary" onClick={() => navigateApp('/login')}>
              <span>Return to login</span>
            </button>
            <button
              type="button"
              className="btn btn--ghost glass-button glass-button--ghost"
              onClick={() => navigateApp('/signup')}
            >
              <span>Resend confirmation</span>
            </button>
            <button
              type="button"
              className="btn btn--ghost glass-button glass-button--ghost"
              onClick={() => {
                setAsyncFailure(null)
                refresh().catch(() =>
                  setAsyncFailure({ state: CALLBACK_STATE.FAILED, message: FAILED_LINK_MESSAGE, detail: '' }),
                )
              }}
            >
              <span>Try again</span>
            </button>
          </div>
        </div>
      </section>
    )
  }

  if (loading || !isAuthenticated) {
    return (
      <section className="adv-shell adv-shell--callback" aria-label="Confirming your email">
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

  return (
    <section className="adv-shell adv-shell--callback" aria-label="Email confirmed">
      <div className="adv-shell__inner adv-shell__inner--narrow">
        <p className="eyebrow eyebrow--plain">CLIRevenue · Email confirmed</p>
        <h2 className="block__title">Your account is ready.</h2>
        <p className="block__body">
          {role ? 'Opening your dashboard…' : 'Resolving your role…'}
        </p>
        {authError ? <p className="block__body">{authError}</p> : null}
      </div>
    </section>
  )
}
