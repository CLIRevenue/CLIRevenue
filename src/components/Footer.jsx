import useAppRoute from '../hooks/useAppRoute.js'
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

  if (isDashboard) return null

  const year = new Date().getFullYear()

  return (
    <footer className="sitefoot" aria-label="Site">
      <div className="sitefoot__inner">
        <div className="sitefoot__brand">
          <span className="sitefoot__mark" aria-hidden="true">▸</span>
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
