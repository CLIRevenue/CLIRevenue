import { useEffect, useState } from 'react'
import { useAuth, roleHome } from './authState.js'
import { navigateApp } from '../../hooks/useAppRoute.js'
import { sendPasswordReset } from '../../lib/authPassword.js'

function FieldError({ message }) {
  if (!message) return null
  return <p className="form__error" role="alert">{message}</p>
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
          <input className="field__input" type="email" name="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
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

export function SignupPage() {
  const { signUp, role, isAuthenticated, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [accountType, setAccountType] = useState('advertiser')
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
    if (!email.trim() || !password || !confirm) {
      setError('Email, password, and confirmation are required.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    if (!['advertiser', 'developer'].includes(accountType)) {
      setError('Pick Advertiser or Developer.')
      return
    }
    setBusy(true)
    try {
      const data = await signUp({ email: email.trim(), password, role: accountType })
      if (data.session) {
        // Session present: provider refresh resolves role and effect redirects.
        setInfo('Account created. Resolving your dashboard…')
      } else {
        // Email confirmation required: no session yet.
        setInfo('Check your email to confirm, then log in. Your dashboard is assigned by role.')
      }
    } catch (err) {
      setError(err.message || 'Signup failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell
      eyebrow="CLIRevenue · Signup"
      title="Create your account."
      body="Advertiser and Developer are the only public options. Admin is never offered here."
      footer="Profiles are created through RLS-safe trigger/RPC paths only. No service-role key is used in the browser."
    >
      <form className="form adv-form" onSubmit={onSubmit} noValidate>
        <label className="field">
          <span className="field__label">Email</span>
          <input className="field__input" type="email" name="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </label>
        <PasswordField label="Password" name="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        <PasswordField label="Confirm password" name="confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        <div className="field" role="group" aria-label="Account type">
          <span className="field__label">Account type</span>
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
        </div>
        <FieldError message={error} />
        {info ? <div className="adv-notice" role="status">{info}</div> : null}
        <button className="btn btn--primary" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Sign up'}
        </button>
        <p className="form__note">
          Have an account? <button type="button" className="adv-link" onClick={() => navigateApp('/login')}>Log in</button>
        </p>
      </form>
    </AuthShell>
  )
}
