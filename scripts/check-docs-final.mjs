// Content verification for the docs/reconciliation task.
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

// Geometry facts belong in the two docs that document geometry. Requiring
// every number on every page (including conceptual ones) produced false
// failures — e.g. getting-started.md has no reason to state 1280×1024.
const GEOMETRY_DOCS = [
  'docs/developer/sdk.md',
  'docs/developer/configuration.md',
]
const docs = [
  'docs/developer/sdk.md',
  'docs/developer/configuration.md',
  'docs/developer/ad-slots.md',
  'docs/developer/getting-started.md',
  'docs/developer/README.md',
  'docs/developer/faq.md',
]

let problems = 0
for (const f of docs) {
  const s = readFileSync(f, 'utf8')
  // 1. Final layout facts must be present in the geometry docs.
  if (GEOMETRY_DOCS.includes(f)) {
    const facts = [
      /120/,
      /1024/,
      /9 anchors|top-left|top-center|center/,
      /±512|512/,
      /render\s*\(/,
    ]
    for (const re of facts) {
      if (!re.test(s)) {
        console.log(`MISSING ${f}: does not contain the final layout facts`)
        problems += 1
      }
    }
  } else {
    // Non-geometry pages are conceptual: they must only avoid stale wording.
    // (render() is documented on sdk.md / ad-slots.md / faq.md, which are checked.)
  }
  // 2. No provisional wording may remain.
  const stale = ['still settling', 'provisional integration point', 'createAd()', 'will not change here without notice', 'future API'].map((w) => [
    w,
    new RegExp(w, 'i'),
  ])
  for (const [word, re] of stale) {
    if (re.test(s)) {
      console.log(`STALE ${f}: contains "${word}"`)
      problems += 1
    }
  }
}

// 3. No createAd anywhere.
const all = docs.map((f) => readFileSync(f, 'utf8')).join('\n')
if (/createAd\(\)/i.test(all)) {
  console.log('STALE: createAd() still referenced')
  problems += 1
}

// 4. ESLint on the Landing JSX (frontend).
try {
  const out = execFileSync(
    'node',
    [
      'node_modules/eslint/bin/eslint.js',
      'src/components/developer/DeveloperLanding.jsx',
      'src/App.jsx',
      'src/components/PublicHeader.jsx',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
} catch (err) {
  console.log('ESLINT FAILED:\n' + (err.stdout || '') + (err.stderr || ''))
  problems += 1
}

if (problems) {
  console.log(`\n${problems} content/tests problem(s) found.`)
  process.exit(1)
}
console.log('\nAll final-API content checks passed.')
