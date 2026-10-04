import { useEffect } from 'react'
import Atmosphere from './components/Atmosphere.jsx'
import Cinema from './components/Cinema.jsx'
import Console from './components/console/Console.jsx'
import AdminConsole from './components/admin/AdminConsole.jsx'
import Conversion from './components/conv/Conversion.jsx'
import AdvertiserApp from './components/advertiser/AdvertiserApp.jsx'
import DeveloperApp from './components/developer/DeveloperApp.jsx'
import DeveloperLanding from './components/developer/DeveloperLanding.jsx'
import AdvertiserLanding from './components/advertiser/AdvertiserLanding.jsx'
import { AuthProvider } from './components/auth/AuthProvider.jsx'
import { LoginPage, SignupPage, AuthCallbackPage } from './components/auth/AuthPages.jsx'
import { RequireRole, AuthLoadingScreen } from './components/auth/RequireAuth.jsx'
import { useAuth, roleHome } from './components/auth/authState.js'
import PublicHeader from './components/PublicHeader.jsx'
import useAppRoute, { navigateApp } from './hooks/useAppRoute.js'
import './components/advertiser/advertiser.css'
import './App.css'

function RoleRedirect() {
  const { loading, isAuthenticated, role } = useAuth()
  const home = roleHome(role)
  useEffect(() => {
    if (loading) return
    navigateApp(!isAuthenticated ? '/login' : home || '/login')
  }, [loading, isAuthenticated, home])
  if (loading) return <AuthLoadingScreen />
  return <AuthLoadingScreen label={role ? 'Opening your dashboard…' : 'Resolving your role…'} />
}

/* The film keeps its own <main> and its own scroll geometry. The
   console and the conversion layer are appended after it, outside
   that main, so no chapter measurement in the cinema hook ever
   sees them. /app/* renders as an isolated dashboard and preserves
   the public site for every other route. Auth is ONE provider; role
   from public.profiles decides which dashboard renders. */
function Routes() {
  const path = useAppRoute()
  const clean = (path.split('?')[0].split('#')[0] || '/').replace(/\/+$/, '') || '/'

  if (clean === '/login') {
    return (
      <>
        <Atmosphere />
        <PublicHeader />
        <LoginPage />
      </>
    )
  }

  if (clean === '/signup') {
    return (
      <>
        <Atmosphere />
        <PublicHeader />
        <SignupPage />
      </>
    )
  }

  // Email confirmation / recovery links land here, establish the session,
  // resolve the profile role, and continue into the right dashboard — no
  // dead-end tab, no raw tokens, no manual "close this tab" step.
  if (clean === '/auth/callback') {
    return (
      <>
        <Atmosphere />
        <AuthCallbackPage />
      </>
    )
  }

  if (clean === '/app/advertiser' || clean.startsWith('/app/advertiser/')) {
    return (
      <>
        <Atmosphere />
        <RequireRole allow={['advertiser']}>
          <AdvertiserApp />
        </RequireRole>
      </>
    )
  }

  if (clean === '/app/developer' || clean.startsWith('/app/developer/')) {
    return (
      <>
        <Atmosphere />
        <RequireRole allow={['developer']}>
          <DeveloperApp />
        </RequireRole>
      </>
    )
  }

  // Public SDK onboarding. No role gate: install does not require an
  // account, and a developer must be able to understand the product
  // before they sign in.
  if (clean === '/developer' || clean.startsWith('/developer/')) {
    return (
      <>
        <Atmosphere />
        <DeveloperLanding />
      </>
    )
  }

  // Public advertiser onboarding — the counterpart to /developer. Same
  // rule: understanding campaigns, targeting, and measurement must not
  // require an account. It is not the role-gated /app/advertiser
  // dashboard, which is matched above and owns the real campaign writes.
  if (clean === '/advertiser' || clean.startsWith('/advertiser/')) {
    return (
      <>
        <Atmosphere />
        <AdvertiserLanding />
      </>
    )
  }

  if (clean === '/app/admin' || clean.startsWith('/app/admin/')) {
    return (
      <>
        <Atmosphere />
        <RequireRole allow={['admin']}>
          <AdminConsole />
        </RequireRole>
      </>
    )
  }

  if (clean === '/app') {
    return (
      <>
        <Atmosphere />
        <RoleRedirect />
      </>
    )
  }

  if (clean.startsWith('/app/')) {
    return (
      <>
        <Atmosphere />
        <RoleRedirect />
      </>
    )
  }

  return (
    <>
      <Atmosphere />
      <PublicHeader />
      <Cinema />
      <Console />
      <Conversion />
    </>
  )
}

function App() {
  return (
    <AuthProvider>
      <Routes />
    </AuthProvider>
  )
}

export default App
