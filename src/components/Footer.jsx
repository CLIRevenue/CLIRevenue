import useAppRoute from '../hooks/useAppRoute.js'
import { useEffect, useState } from 'react'
import './Footer.css'
import HeartFooter from './landing/HeartFooter.jsx'

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
        {/* First cell of the grid, so the heart is the top-left thing a
            reader meets in the footer rather than a stray control wedged
            between the legal links and the copyright. */}
        <HeartFooter />

        <div className="sitefoot__brand">
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
