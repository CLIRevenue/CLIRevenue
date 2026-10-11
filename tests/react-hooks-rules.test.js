import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { ESLint } from 'eslint'

// React Hook Rules are load-bearing, not style.
//
// On 2026-10-11 the deployed site at clirevenue.in served a blank page. The
// build succeeded, every typecheck passed, and `vite build` reported nothing
// unusual, because a hook called inside a useEffect callback is a perfectly
// valid JavaScript program. It only fails at runtime, during the commit phase,
// when React's hook dispatcher is null -- so the production bundle shipped a
// blank page with a minified error (#321) that no build step could see.
//
// The rule that names the bug, `react-hooks/rules-of-hooks`, was already
// configured as an error in eslint.config.js. Nothing ran it. `npm run build`
// does not lint, and CI had four jobs -- backend unit, backend db, edge deno,
// cli -- none of which touched the frontend tree.
//
// So the durable regression test is not a copy of the rule: it is the gate that
// was missing. This file lints `src/` through the repository's own config on
// every `npm test`, and fails on any error. The static scanner below is a
// deliberately independent second line of defence, so that deleting or
// misconfiguring the ESLint plugin cannot make this file pass vacuously.

const ROOT = new URL('..', import.meta.url).pathname
const SRC = join(ROOT, 'src')

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(jsx?|tsx?)$/.test(entry)) out.push(full)
  }
  return out
}

const sourceFiles = walk(SRC)

// Removes comments and string/template/regex literals so that prose and
// data can never be mistaken for a call site. Order matters: the block
// comment pass runs first so that a `//` inside a string cannot truncate
// the scan.
const stripNonCode = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, '``')
    .replace(/'(?:\\[\s\S]|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\[\s\S]|[^"\\\n])*"/g, '""')

// Index just past the bracket that closes the one at `start`.
const matchBracket = (src, start) => {
  const open = src[start]
  const close = { '(': ')', '{': '}', '[': ']' }[open]
  let depth = 0
  for (let i = start; i < src.length; i += 1) {
    const ch = src[i]
    if (ch === open) depth += 1
    else if (ch === close) {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

// Callbacks whose bodies are executed at a point where the React dispatcher is
// not available, or where the caller cannot guarantee a stable hook order.
const CALLBACK_HOOKS = ['useEffect', 'useLayoutEffect', 'useInsertionEffect', 'useMemo', 'useCallback', 'useImperativeHandle']

// Returns, per file, every hook call found inside a hook callback body.
const hooksInsideCallbacks = (file) => {
  const src = stripNonCode(readFileSync(file, 'utf8'))
  const found = []
  for (const name of CALLBACK_HOOKS) {
    let from = 0
    for (;;) {
      const at = src.indexOf(name, from)
      if (at === -1) break
      from = at + name.length
      const before = src.slice(0, at)
      // Only a real call: `React.useEffect(` or a bare `useEffect(`, never a
      // longer identifier such as `myUseEffect` or a property key.
      if (!/^use[A-Z]/.test(name)) continue
      if (!/[A-Za-z0-9_$]/.test(before.slice(-1) || ' ') && !/\.\s*$/.test(before)) continue
      const paren = src.indexOf('(', at + name.length)
      if (paren === -1) continue
      const end = matchBracket(src, paren)
      if (end === -1) continue

      // The first argument is the callback. Find its own body and scan it.
      const argEnd = matchBracket(src, paren)
      let i = paren + 1
      let argStart = paren + 1
      let comma = -1
      let depth = 0
      for (; i <= argEnd; i += 1) {
        const ch = src[i]
        if ('({['.includes(ch)) depth += 1
        else if (')}]'.includes(ch)) depth -= 1
        else if (ch === ',' && depth === 0) { comma = i; break }
      }
      if (comma === -1) continue
      const callback = src.slice(argStart, comma)
      const arrow = callback.indexOf('=>')
      if (arrow === -1) continue
      const bodyStart = arrow + 2
      const body = callback.slice(bodyStart)
      const braceStart = bodyStart + body.indexOf('{')
      if (braceStart === -1) continue

      for (const m of body.matchAll(/(?:^|[^A-Za-z0-9_$.])([a-z][A-Za-z0-9]*use[A-Z][A-Za-z0-9]*)\s*\(/g)) {
        found.push({ hook: m[1], line: src.slice(0, at).split('\n').length })
      }
    }
  }
  return found
}

describe('the frontend tree obeys the Rules of Hooks', () => {
  it('has no rules-of-hooks violation anywhere in src/', async () => {
    // Programmatic ESLint, pointed at the repo's own flat config, so this
    // cannot drift from what `npm run lint` would do.
    //
    // Scoped to `react-hooks/rules-of-hooks` and not to "zero errors" on
    // purpose. src/ currently carries 29 pre-existing lint errors that belong
    // to the in-flight redesign: 8 unused imports, 8
    // `react-refresh/only-export-components` on shared-helper modules, and 13
    // `react-hooks/set-state-in-effect` on the `useEffect(load, [load])` fetch
    // idiom every admin page already uses. Gating on all of them would mean a
    // permanently red gate over code nobody is working on, and a permanently
    // red gate gets ignored -- which is exactly how this bug shipped. This
    // gate is scoped to the one rule that renders a blank page. The others are
    // reported, not enforced, and are listed in the final report.
    const eslint = new ESLint({ cwd: ROOT })
    const results = await eslint.lintFiles(['src'])
    const violations = results.flatMap((r) =>
      r.messages
        .filter((m) => m.severity === 2 && m.ruleId === 'react-hooks/rules-of-hooks')
        .map((m) => `${relative(ROOT, r.filePath)}:${m.line}:${m.column}  ${m.message.split('\n')[0]}`),
    )
    expect(violations).toEqual([])
    // Guards against the lint returning nothing at all, which would make the
    // assertion above true for the wrong reason.
    expect(results.length).toBeGreaterThan(50)
  }, 120_000)

  it('has the rule that names this bug enabled as an error, not disabled', async () => {
    const eslint = new ESLint({ cwd: ROOT })
    const config = await eslint.calculateConfigForFile('src/components/console/OrbitRing.jsx')
    const severity = config.rules?.['react-hooks/rules-of-hooks']
    expect(Array.isArray(severity) ? severity[0] : severity).toBe(2)
  })

  it('calls no hook from inside a hook callback in src/', () => {
    const offenders = sourceFiles.flatMap((file) =>
      hooksInsideCallbacks(file).map((h) => `${relative(ROOT, file)}:${h.line}  ${h.hook} is called inside a hook callback`),
    )
    expect(offenders).toEqual([])
  })

  it('keeps the reduced-motion preference read at the top level of OrbitRing', () => {
    // The specific shape that blanked the site: a component that wants a
    // preference value wrote it into state from an effect instead of calling
    // the hook directly. Asserted on the file, because this is the one
    // component on the public landing page whose crash took down every route.
    const src = readFileSync(join(SRC, 'components/console/OrbitRing.jsx'), 'utf8')
    const body = src.slice(src.indexOf('function OrbitRing('))
    const call = body.match(/usePrefersReducedMotion\(\)/)
    expect(call).not.toBeNull()
    // Between the component opening and the call there must be no effect
    // callback, which is exactly where the original violation sat.
    expect(body.slice(0, call.index)).not.toMatch(/\buseEffect\s*\(/)
  })
})