import { useEffect, useState } from 'react'

function getPath() {
  if (typeof window === 'undefined') return '/'
  const { pathname, hash, search } = window.location
  // Hash fallback for static hosts: #/login, #/signup, #/auth/callback,
  // #/app/... mirror pathnames. /auth/callback MUST be listed here — it
  // is where every confirmation email lands, and a host that routes by
  // hash would otherwise serve the homepage instead of the callback.
  if (hash && (hash.startsWith('#/app') || hash.startsWith('#/login') || hash.startsWith('#/signup') || hash.startsWith('#/auth/callback'))) return hash.slice(1)
  return `${pathname || '/'}${search || ''}`
}

export function navigateApp(path) {
  const next = path.startsWith('/') ? path : `/${path}`
  // Never clobber in-page anchors like #workbench: app routes use pathname.
  window.history.pushState({}, '', next)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export default function useAppRoute() {
  const [path, setPath] = useState(() => getPath())
  useEffect(() => {
    const onChange = () => setPath(getPath())
    window.addEventListener('popstate', onChange)
    window.addEventListener('hashchange', onChange)
    return () => {
      window.removeEventListener('popstate', onChange)
      window.removeEventListener('hashchange', onChange)
    }
  }, [])
  return path
}

export function isAppRoute(path) {
  return path === '/app' || path.startsWith('/app/')
}
