import { useEffect } from 'react'
import Atmosphere from './components/Atmosphere.jsx'
import Cinema from './components/Cinema.jsx'
import Console from './components/console/Console.jsx'
import Conversion from './components/conv/Conversion.jsx'
import AdvertiserApp from './components/advertiser/AdvertiserApp.jsx'
import DeveloperApp from './components/developer/DeveloperApp.jsx'
import { AuthProvider } from './components/auth/AuthProvider.jsx'
import { LoginPage, SignupPage } from './components/auth/AuthPages.jsx'
import { RequireRole, AuthLoadingScreen } from './components/auth/RequireAuth.jsx'
import { useAuth, roleHome } from './components/auth/authState.js'
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
        <LoginPage />
      </>
    )
  }

  if (clean === '/signup') {
    return (
      <>
        <Atmosphere />
        <SignupPage />
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

  if (clean === '/app/admin' || clean.startsWith('/app/admin/')) {
    return (
      <>
        <Atmosphere />
        <RequireRole allow={['admin']}>
          <section className="adv-shell" aria-label="Admin">
            <div className="adv-shell__inner adv-shell__inner--narrow">
              <p className="eyebrow eyebrow--plain">Admin</p>
              <h2 className="block__title">No admin app ships in this repo yet.</h2>
              <p className="block__body">Signed in as admin. Admin UI is out of scope for this change.</p>
            </div>
          </section>
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
