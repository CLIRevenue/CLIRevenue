/**
 * "Creating a key in-site does not work."
 *
 * It did not work, and nothing on screen said so: the key was minted on the
 * server and then discarded in the UI. Three independent faults, each of
 * which alone is enough to lose the key.
 *
 * 1. The response was read with the wrong shape.
 *    `supabase/functions/publisher_keys/index.ts` answers POST with
 *    `{ key: { ...KEY_COLUMNS, publishableKey: rawKey } }`, and
 *    `src/lib/publisherKeysApi.js` already unwraps that envelope
 *    (`return json.key`). The resolved value is therefore the flat row.
 *    PublisherKeys read it as `const { key, rawKey } = createdKey` -- the
 *    wire shape, which is exactly what the API's own docstring claimed it
 *    returned. Both properties were `undefined`: the plate fell back to the
 *    literal `"pk_test_••••••••••••••••"` and `<CopyButton text={undefined} />`
 *    wrote `undefined` to the clipboard. The developer's only copy of the
 *    key was the masked fragment and a broken copy button.
 *
 * 2. A conflict was reported as a dead end.
 *    `publisher_keys_active_env_key` permits exactly one unrevoked key per
 *    (publisher_id, key_env), and key_env is hardcoded "test", so a second
 *    key cannot exist until the first is revoked. The function answers that
 *    with 409 / `code: 'KEY_EXISTS'` and the blocking row in `existingKey` --
 *    an actionable conflict. The client flattened it to "Could not create
 *    publisher key. Please try again.", which is not true and not a step.
 *
 * 3. The failure view owned every screen.
 *    `if (error) return <full-page error>` was evaluated before the
 *    `tab === 'creating'` branch, so ANY error raised while the form was
 *    open -- including the client-side "Please enter a label" -- replaced
 *    the form with a page whose only action reloaded the list. The developer
 *    had no route back to the form but a browser refresh.
 *
 * These are source-shape assertions for the same reason as
 * tests/publisher-keys-contract.test.js: the handler needs a live Supabase,
 * and every failure above is a decision made in the client, not the
 * database. The one-act-per-environment invariant itself is asserted
 * against the real schema in tests/db/publisher-keys-active.test.js.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')

const keys = () => readFileSync(join(ROOT, 'src/components/developer/PublisherKeys.jsx'), 'utf8')
const api = () => readFileSync(join(ROOT, 'src/lib/publisherKeysApi.js'), 'utf8')
const fn = () => readFileSync(join(ROOT, 'supabase/functions/publisher_keys/index.ts'), 'utf8')

/** Strip comments so prose naming a shape is never mistaken for the shape. */
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** The JSX of one render branch, bounded by its own guard. */
const branch = (guard) => {
  const source = code(keys())
  const start = source.indexOf(guard)
  if (start < 0) return ''
  const next = source.indexOf('\n  if (', start + 1)
  return source.slice(start, next > start ? next : source.length)
}

describe('the created key is read with the shape the API actually returns', () => {
  it('createPublisherKey returns the inner row, not the envelope', () => {
    // The unwrap is the whole reason the consumer must not destructure
    // `{ key }`. If this ever changes, the assertion below is what notices.
    const body = code(api())
    const create = body.slice(body.indexOf('export async function createPublisherKey'))
    expect(create).toMatch(/return json\.key/)
  })

  it('reads publishableKey and key_prefix off the returned row', () => {
    const created = branch("if (tab === 'created')")
    expect(created).toMatch(/createdKey\?\.publishableKey \|\| null/)
    expect(created).toMatch(/createdKey\?\.key_prefix \|\| null/)
    // The wire shape, which is what the old code used. `key` and `rawKey` do
    // not exist on the resolved value and both resolve to undefined.
    expect(created).not.toMatch(/const \{ key, rawKey \} = createdKey/)
    expect(created).not.toMatch(/\{ key\b.*\brawKey\b.*\}\s*=\s*createdKey/)
  })

  it('never hands CopyButton a missing value', () => {
    // CopyButton has no disabled state: `writeText(undefined)` silently
    // writes the string "undefined" and then flips to COPIED, so the control
    // reports success while copying nothing. The copy affordance exists only
    // when there is something to copy.
    const created = branch("if (tab === 'created')")
    expect(created).toMatch(/\{rawKey \? \(/)
    expect(created).toMatch(/<CopyButton text=\{rawKey\}/)
    expect(created).toMatch(/<CopyButton[\s\S]*?\)\s*:\s*\(/)
  })

  it('the Edge Function really does put publishableKey beside the row columns', () => {
    // Guards the assumption on both sides at once: if the handler renames the
    // field, this and the assertion above move together.
    expect(fn()).toMatch(/key:\s*\{[\s\S]*?\.\.\.row,[\s\S]*?publishableKey:\s*rawKey,[\s\S]*?\}/)
    expect(fn()).toMatch(/const KEY_COLUMNS = "[^"]*key_prefix[^"]*"/)
  })
})

describe('a key that already exists is reported as the conflict it is', () => {
  it('reads the 409 as KEY_EXISTS and names the key that is in the way', () => {
    const source = code(keys())
    const create = source.slice(source.indexOf('const handleCreateKey'))
    expect(create).toMatch(/err\?\.status === 409/)
    expect(create).toMatch(/KEY_EXISTS/)
    // The server sends `existingKey`; using it is the difference between
    // "revoke that one" and a retry the developer knows will fail again.
    expect(create).toMatch(/err\.payload\.existingKey/)
    expect(create).toMatch(/revoke/i)
    // And it must not be collapsed into the generic failure.
    expect(create).toMatch(/Could not create publisher key\. Please try again\./)
  })

  it('authedFetch surfaces the status and payload the branch depends on', () => {
    const body = code(api())
    const fetchImpl = body.slice(body.indexOf('async function authedFetch'))
    expect(fetchImpl).toMatch(/err\.status = res\.status/)
    expect(fetchImpl).toMatch(/err\.payload = json/)
  })

  it('the invariant it reports is real: one unrevoked key per publisher and env', () => {
    // If the database stopped enforcing this the 409 would never fire and the
    // message would be describing a condition that cannot happen.
    expect(fn()).toMatch(/ActiveKeyExistsError/)
    expect(fn()).toMatch(/KEY_EXISTS/)
    // The property name is the contract between the two halves; if the
    // handler renames it, the branch above silently degrades to a fallback.
    expect(fn()).toMatch(/existingKey:\s*err\.existing/)
  })
})

describe('the failure view cannot strand the developer on the create form', () => {
  it('the full-page error belongs to the list view only', () => {
    // Ordering alone is the bug: `if (error)` sat above the tab branches, so
    // an error raised inside the form replaced the form. The guard now says
    // which screen owns it.
    const source = code(keys())
    expect(source).toMatch(/if \(error && tab === 'list'\)/)
    expect(source).not.toMatch(/^\s*if \(error\) \{/m)
  })

  it('no tab view can be reached by the failure view', () => {
    // The guard naming `list` is the whole fix, and it is stronger than
    // ordering: `if (error && tab === 'list')` cannot match tab 'creating' or
    // 'created', so neither can be pre-empted no matter where it sits in the
    // chain. The ordering that broke it was an UNCONDITIONAL `if (error)`.
    const source = code(keys())
    const failure = source.indexOf('if (error && tab === \'list\')')
    expect(failure).toBeGreaterThan(-1)
    expect(source.match(/if \(error[^\n]*\) \{/g)).toHaveLength(1)
  })

  it('keeps the error on the create form inline and announced', () => {
    const creating = branch("if (tab === 'creating')")
    expect(creating).toMatch(/setup__text-error/)
    expect(creating).toMatch(/role="alert"/)
    // The form must still offer its way out.
    expect(creating).toMatch(/onClick=\{\(\) => setTab\('list'\)\}/)
  })

  it('the created view reports a failed refresh without discarding the key', () => {
    // handleDismissCreated re-runs the list, which can fail on its own. The
    // key is already in the developer's hands by then, so the plate stays.
    const created = branch("if (tab === 'created')")
    expect(created).toMatch(/\{error && \(/)
    expect(created).toMatch(/<CopyButton/)
    expect(created).toMatch(/handleDismissCreated/)
  })

  it('offers a route forward from the list failure view', () => {
    const failure = branch("if (error && tab === 'list')")
    expect(failure).toMatch(/onClick=\{fetchKeys\}/)
    expect(failure).toMatch(/setTab\('creating'\)/)
  })
})