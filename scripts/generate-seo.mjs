import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ROUTE_SEO, canonicalUrl } from '../src/seo/routeMeta.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const distDir = join(__dirname, '..', 'dist')
const indexPath = join(distDir, 'index.html')

function withMetadata(html, path, meta) {
  const canonical = canonicalUrl(path)
  let output = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(meta.title)}</title>`)
  output = replaceMeta(output, 'name', 'description', meta.description)
  output = replaceMeta(output, 'property', 'og:title', meta.title)
  output = replaceMeta(output, 'property', 'og:description', meta.description)
  output = replaceMeta(output, 'property', 'og:url', canonical)
  output = replaceMeta(output, 'property', 'og:type', 'website')
  output = replaceMeta(output, 'name', 'twitter:card', 'summary')
  output = replaceMeta(output, 'name', 'twitter:title', meta.title)
  output = replaceMeta(output, 'name', 'twitter:description', meta.description)
  output = replaceLink(output, 'canonical', canonical)
  return output
}

function replaceMeta(html, attr, key, content) {
  const regex = new RegExp(`<meta\\s+${attr}="${key}"\\s+content="[^"]*"\\s*/?>`, 'i')
  const tag = `<meta ${attr}="${key}" content="${escapeAttr(content)}" />`
  if (regex.test(html)) return html.replace(regex, tag)
  return html.replace('</head>', `  ${tag}\n  </head>`)
}

function replaceLink(html, rel, href) {
  const regex = new RegExp(`<link\\s+rel="${rel}"\\s+href="[^"]*"\\s*/?>`, 'i')
  const tag = `<link rel="${rel}" href="${escapeAttr(href)}" />`
  if (regex.test(html)) return html.replace(regex, tag)
  return html.replace('</head>', `  ${tag}\n  </head>`)
}

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, '&quot;')
}

const baseHtml = await readFile(indexPath, 'utf8')

for (const [path, meta] of Object.entries(ROUTE_SEO)) {
  if (path === '/') continue
  const routeDir = join(distDir, path.replace(/^\/+/, ''))
  await mkdir(routeDir, { recursive: true })
  await writeFile(join(routeDir, 'index.html'), withMetadata(baseHtml, path, meta), 'utf8')
}

const rootHtml = withMetadata(baseHtml, '/', ROUTE_SEO['/'])
await writeFile(indexPath, rootHtml, 'utf8')
console.log('Generated route SEO HTML for', Object.keys(ROUTE_SEO).join(', '))
