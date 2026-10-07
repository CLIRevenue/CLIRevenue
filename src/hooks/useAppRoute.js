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

/**
 * onClick for an in-app anchor. The href stays; only the click is intercepted.
 *
 * `<a href="/advertiser">` inside a single-page app issues a full document
 * request. The browser throws away the loaded app, re-fetches every module and
 * replays the entire boot — intro film, role check, data fetch — so a link that
 * is one click away costs the visitor the whole opening again. Keeping the href
 * is still the right call: it is what makes the link copyable, middle-clickable,
 * open-in-new-tab-able and readable without JavaScript. Only a plain left click
 * is a request for *this* app to navigate.
 *
 * Modifier clicks and non-primary buttons are requests for a new tab or a new
 * window, so they are handed straight back to the browser. `defaultPrevented` is
 * honoured so a caller can veto a specific link without this helper having to
 * know which ones are vetoable.
 *
 * The path is read back off the element rather than captured at render time, so
 * one handler serves every in-app anchor in the app and cannot disagree with the
 * href a reader can see in the markup.
 */
export function spaNav(event) {
  if (event.defaultPrevented) return
  if (event.button !== 0) return
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const href = event.currentTarget.getAttribute('href')
  if (!href || !href.startsWith('/')) return
  event.preventDefault()
  navigateApp(href)
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
