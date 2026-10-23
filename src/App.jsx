import { useEffect, useRef } from 'react'
import Atmosphere from './components/Atmosphere.jsx'
import Landing from './components/landing/Landing.jsx'
import AdminConsole from './components/admin/AdminConsole.jsx'
import AdvertiserApp from './components/advertiser/AdvertiserApp.jsx'
import DeveloperApp from './components/developer/DeveloperApp.jsx'
import DeveloperLanding from './components/developer/DeveloperLanding.jsx'
import AdvertiserLanding from './components/advertiser/AdvertiserLanding.jsx'
import { AuthProvider } from './components/auth/AuthProvider.jsx'
import { LoginPage, SignupPage, AuthCallbackPage } from './components/auth/AuthPages.jsx'
import { RequireRole, AuthLoadingScreen } from './components/auth/RequireAuth.jsx'
import { useAuth, roleHome } from './components/auth/authState.js'
import PageChrome from './components/landing/PageChrome.jsx'
import Footer from './components/Footer.jsx'
import PrivacyPolicyPage from './components/PrivacyPolicyPage.jsx'
import TermsConditionsPage from './components/TermsConditionsPage.jsx'
import useAppRoute, { navigateApp } from './hooks/useAppRoute.js'
import { setRouteMetadata } from './seo/routeMeta.js'
import { usePageViewTracking } from './hooks/usePageViewTracking.js'
import './components/advertiser/advertiser.css'
import './App.css'
/* LAST stylesheet in the bundle, on purpose. fx.css is the effects
   layer, and an effects rule that ties on specificity with a component
   rule has to win — otherwise the press, the focus halo and the primary
   button colour would each need fixing in the component instead. */
import './fx.css'

/* one delegated pointer listener for every spotlight card on the page. */
import SpotlightTracker from './components/cine/SpotlightTracker.jsx'
import FxLayer from './components/FxLayer.jsx'

/* The transition veil. React remounts this the instant the path changes
   (because the key changes), which is what replays the CSS sweep -- so the
   animation costs no JavaScript and cannot desync from the router. The
   previous path is held in a ref rather than state so that StrictMode's
   double-render does not render the veil twice. */
function RouteVeil() {
  const path = useAppRoute()
  const last = useRef(null)
  const seen = last.current !== null && last.current !== path
  last.current = path
  if (!seen) return null
  return <div className="route-veil" key={path} aria-hidden="true" />
}

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
  useEffect(() => {
    setRouteMetadata(clean)
  }, [clean])

  if (clean === '/login') {
    return (
      <>
        <Atmosphere />
        <LoginPage />
        <Footer />
      </>
    )
  }

  if (clean === '/signup') {
    return (
      <>
        <Atmosphere />
        <SignupPage />
        <Footer />
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
        <Footer />
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
        <Footer />
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
        <Footer />
      </>
    )
  }

  if (clean === '/privacy' || clean.startsWith('/privacy')) {
    return (
      <>
        <Atmosphere />
        <PageChrome>
          <PrivacyPolicyPage />
        </PageChrome>
        <Footer />
      </>
    )
  }

  if (clean === '/terms' || clean.startsWith('/terms')) {
    return (
      <>
        <Atmosphere />
        <PageChrome>
          <TermsConditionsPage />
        </PageChrome>
        <Footer />
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
      <Landing />
    </>
  )
}

function App() {
  usePageViewTracking()
  return (
    <AuthProvider>
      {/* Three global render layers, all decorative and all above the router:
          the WebGL canvas that scrolls with the page, the one delegated
          pointer listener that drives every spotlight card, and the effects
          layer — scroll progress, arrival reveals, the count-up on figures,
          the ambient depth field. None of them knows which route is mounted,
          so none of them has to be re-created per route. */}
      <SpotlightTracker />
      <RouteVeil />
      <FxLayer />
      <Routes />
    </AuthProvider>
  )
}

export default App
