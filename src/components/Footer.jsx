import useAppRoute from '../hooks/useAppRoute.js'
import { useEffect, useState } from 'react'
import './Footer.css'

export default function Footer() {
  const path = useAppRoute()
  const clean = (path.split('?')[0].split('#')[0] || '/').replace(/\/+$/, '') || '/'

  const isDashboard =
    clean === '/app/advertiser' ||
    clean.startsWith('/app/advertiser/') ||
    clean === '/app/developer' ||
    clean.startsWith('/app/developer/') ||
    clean === '/app/admin' ||
    clean.startsWith('/app/admin/') ||
    clean === '/app' ||
    clean.startsWith('/app/')

  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('theme')
    return saved === 'light' ? 'light' : 'dark'
  })

  useEffect(() => {
    const handler = () => {
      const saved = localStorage.getItem('theme')
      setTheme(saved === 'light' ? 'light' : 'dark')
    }
    window.addEventListener('storage', handler)
    handler() // initial sync
    return () => window.removeEventListener('storage', handler)
  }, [])

  if (isDashboard) return null

  const logoSrc = theme === 'light' ? '/brand/clirevenue-logo-light.png' : '/brand/clirevenue-logo-dark.png'
  const year = new Date().getFullYear()

  return (
    <footer className="sitefoot" aria-label="Site">
      <div className="sitefoot__inner">
        <div className="sitefoot__brand">
          <img
            className="sitefoot__logo"
            src={logoSrc}
            alt=""
            aria-hidden="true"
            width="28"
            height="28"
          />
          <span className="sitefoot__name">CLI<em>Revenue</em></span>
        </div>

        <nav className="sitefoot__nav" aria-label="Legal">
          <a className="sitefoot__link" href="/privacy">Privacy Policy</a>
          <a className="sitefoot__link" href="/terms">Terms & Conditions</a>
          <a className="sitefoot__link" href="mailto:clirevenue@gmail.com">Contact</a>
        </nav>

        <p className="sitefoot__copy">
          © {year} CLIRevenue. All rights reserved.
        </p>
      </div>
    </footer>
  )
}
