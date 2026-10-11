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

  const year = new Date().getFullYear()

  return (
    <footer className="sitefoot" aria-label="Site">
      <div className="sitefoot__inner">
        <div className="sitefoot__brand">
          <svg
            className="sitefoot__logo"
            viewBox="0 0 28 28"
            width="28"
            height="28"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <rect x="2" y="2" width="24" height="24" rx="0" fill="var(--bg)" strokeWidth="0" />
            <rect x="2" y="2" width="24" height="24" rx="0" stroke="var(--electric-cyan)" strokeWidth="1.5" />
            <path d="M6 6h2v16H6v-4h1" stroke="var(--electric-cyan)" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M10 6h2v16h-2v-8h6v2h2V6h-2v4H12V6" stroke="var(--hyper-violet)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
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
