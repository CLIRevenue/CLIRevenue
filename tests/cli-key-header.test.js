import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')

const cli = () => readFileSync(join(ROOT, 'supabase/functions/cli/index.ts'), 'utf8')

/**
 * Strip block and line comments before asserting on bodies, for the same
 * reason as the publisher-keys contract: prose that names an API must not
 * satisfy a call assertion.
 */
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/**
 * The `GET /cli/placements` credential migration.
 *
 * `verifyKey` used to send `?publisherKey=` in the URL, which lands the
 * secret in gateway logs, proxy logs and shell history. New clients send the
 * `x-clirevenue-publisher-key` header; the server accepts the header and
 * keeps the legacy query parameter only for already-released CLIs (see
 * docs/DEPLOYMENT_CHECKLIST.md for the deprecation plan).
 */
describe('the CLI placements key migration', () => {
  it('reads the key from the header first and the legacy query as a fallback', () => {
    const source = code(cli())
    expect(source).toMatch(/x-clirevenue-publisher-key/)
    expect(source).toMatch(/searchParams\.get\("publisherKey"\)/)
    // Header wins when both travel: a stale query string must not confuse a
    // client in transition.
    const fn = source.slice(source.indexOf('function readPublisherKey'))
    expect(fn.indexOf('x-clirevenue-publisher-key')).toBeLessThan(fn.indexOf('searchParams'))
  })

  it('authenticates the resolved key the same way on the header path', () => {
    // Cheap but load-bearing: the header is only useful if the resolved
    // value actually reaches authenticatePublisher.
    const source = code(cli())
    const handler = source.slice(source.indexOf('if (req.method === "GET")'))
    expect(handler).toMatch(/readPublisherKey\(req,\s*url\)/)
    expect(handler).toMatch(/authenticatePublisher\(admin,\s*publisherKey\)/)
  })

  it('never logs the key', () => {
    const source = cli()
    expect(source).not.toMatch(/console\.(log|error)\([^)]*publisherKey[^)]*\)/)
    expect(source).not.toMatch(/console\.(log|error)\([^)]*rawKey[^)]*\)/)
  })
})
