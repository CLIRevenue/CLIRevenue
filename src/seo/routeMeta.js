const SITE_URL = 'https://clirevenue.in'
const DEFAULT_IMAGE = `${SITE_URL}/brand/clirevenue-logo-dark.png`

export const ROUTE_SEO = {
  '/': {
    title: 'CLIRevenue — turn terminal attention into shared revenue',
    description:
      'CLIRevenue — a dedicated advertising slot above the command line, with shared revenue for advertisers, users, developers, and the platform.',
  },
  '/developer': {
    title: 'CLIRevenue for Developers — SDK integration and ad placements',
    description:
      'Install @clirevenue/sdk, create placements, render ads in CLI environments, and track delivery with CLIRevenue.',
  },
  '/advertiser': {
    title: 'CLIRevenue for Advertisers — campaigns, targeting, and measurement',
    description:
      'Create and manage CLI advertising campaigns, target audiences and placements, and measure delivery through CLIRevenue.',
  },
  '/privacy': {
    title: 'Privacy Policy — CLIRevenue',
    description: 'How CLIRevenue collects, uses, retains, and protects data.',
  },
  '/terms': {
    title: 'Terms & Conditions — CLIRevenue',
    description: 'Terms governing use of the CLIRevenue advertising platform.',
  },
}

export function canonicalUrl(pathname) {
  const normalized = pathname === '/' ? '/' : pathname.replace(/\/+$/, '')
  return `${SITE_URL}${normalized}`
}

export function getRouteSeo(pathname) {
  const normalized = (pathname || '/').split('?')[0].split('#')[0] || '/'
  const base = normalized.replace(/\/+$/, '') || '/'
  const entry = ROUTE_SEO[base]
  if (!entry) return null
  return {
    ...entry,
    canonical: canonicalUrl(base),
    image: DEFAULT_IMAGE,
    path: base,
  }
}

export function setRouteMetadata(pathname) {
  if (typeof document === 'undefined') return
  const meta = getRouteSeo(pathname)
  if (!meta) return
  document.title = meta.title
  setMeta('description', meta.description)
  setLink('canonical', meta.canonical)
  setMetaProperty('og:title', meta.title)
  setMetaProperty('og:description', meta.description)
  setMetaProperty('og:url', meta.canonical)
  setMetaProperty('og:image', meta.image)
  setMetaProperty('og:type', 'website')
  setMeta('twitter:title', meta.title)
  setMeta('twitter:description', meta.description)
  setMeta('twitter:card', 'summary')
}

function setMeta(name, content) {
  let element = document.querySelector(`meta[name="${name}"]`)
  if (!element) {
    element = document.createElement('meta')
    element.setAttribute('name', name)
    document.head.appendChild(element)
  }
  element.setAttribute('content', content)
}

function setMetaProperty(property, content) {
  let element = document.querySelector(`meta[property="${property}"]`)
  if (!element) {
    element = document.createElement('meta')
    element.setAttribute('property', property)
    document.head.appendChild(element)
  }
  element.setAttribute('content', content)
}

function setLink(rel, href) {
  let element = document.querySelector(`link[rel="${rel}"]`)
  if (!element) {
    element = document.createElement('link')
    element.setAttribute('rel', rel)
    document.head.appendChild(element)
  }
  element.setAttribute('href', href)
}
