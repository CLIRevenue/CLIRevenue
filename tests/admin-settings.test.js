/**
 * The admin "Settings" entry is a real page, not a dead button.
 *
 * Background: AdminConsole shipped a sidebar button labelled "Settings" whose
 * onClick was `() => {}`. It rendered in the nav next to eight working
 * entries, so the admin surface promised a settings page and delivered nothing
 * — a placeholder presented as a feature.
 *
 * These assertions exist so that regression is loud. The three failure modes
 * they catch:
 *   1. the button comes back with an empty or absent handler,
 *   2. it renders a page that is missing or a stub,
 *   3. it loses its active-state wiring, so the admin cannot see which page
 *      they are on.
 *
 * It deliberately does NOT assert on layout, or on anything the shared
 * AccountPage presents. It does assert on the nav label, for one reason: the
 * same page used to be called "Settings" here and "Account" in the other two
 * dashboards, which reads as two different surfaces. The three sidebars must
 * now agree on the word, so that a user who learns one nav can read the other.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

const consoleSrc = read('src/components/admin/AdminConsole.jsx')

describe('admin settings entry is functional', () => {
  it('no longer carries an empty click handler', () => {
    // The original defect, verbatim.
    expect(consoleSrc).not.toMatch(/onClick=\{\s*\(\s*\)\s*=>\s*\{\s*\}\s*\}/)
  })

  it('the settings entry is declared in a page map, not hardcoded markup', () => {
    expect(consoleSrc).toMatch(/OPERATIONS_PAGES/)
    expect(consoleSrc).toMatch(/account:\s*\{\s*label:\s*['"]Account['"]/)
  })

  it('calls the entry "Account" everywhere, like the other two dashboards', () => {
    // The shared page renders Profile / Security / Preferences / Danger zone.
    // "Settings" promised a preferences surface; "Account" is what it is, and
    // the advertiser and developer sidebars already said so.
    expect(consoleSrc).not.toMatch(/label:\s*['"]Settings['"]/)
    const otherLabels = [
      'src/components/advertiser/AdvertiserApp.jsx',
      'src/components/developer/DeveloperApp.jsx',
    ]
    for (const path of otherLabels) {
      expect(read(path)).toMatch(/id:\s*['"]account['"],\s*label:\s*['"]Account['"]/)
    }
  })

  it('renders its item through the shared nav mapper so active state is wired', () => {
    // Same mechanism as the Platform entries: handleNav + aria-current.
    expect(consoleSrc).toMatch(/Object\.entries\(OPERATIONS_PAGES\)\.map/)
    expect(consoleSrc).toMatch(/onClick=\{\(\)\s*=>\s*handleNav\(key\)\}/)
    expect(consoleSrc).toMatch(/aria-current=\{page === key \? 'page' : undefined\}/)
  })

  it('gives the settings item its own active class', () => {
    expect(consoleSrc).toMatch(
      /adm-nav__btn\$\{page === key \? ' adm-nav__btn--active' : ''\}/
    )
  })

  it('resolves the settings page in the component lookup, with a safe fallback', () => {
    expect(consoleSrc).toMatch(/PAGE_COMPONENTS/)
    expect(consoleSrc).toMatch(/account:\s*AdminAccount/)
    // An unknown key must render a page, never crash the console.
    expect(consoleSrc).toMatch(/PAGE_COMPONENTS\[page\] \|\| AdminOverview/)
  })
})

describe('the admin settings target is a real surface', () => {
  const accountPath = 'src/components/admin/AdminAccount.jsx'

  it('exists', () => {
    expect(existsSync(join(ROOT, accountPath))).toBe(true)
  })

  it('delegates to the shared AccountPage instead of inventing a fourth UI', () => {
    const src = read(accountPath)
    expect(src).toMatch(/import AccountPage from '\.\.\/advertiser\/AccountPage\.jsx'/)
    expect(src).toMatch(/<AccountPage/)
  })

  it('binds the admin role', () => {
    expect(read(accountPath)).toMatch(/role="admin"/)
  })

  it('reads identity from auth rather than hardcoding it', () => {
    const src = read(accountPath)
    expect(src).toMatch(/useAuth\(\)/)
    expect(src).toMatch(/email=\{auth\.user\?\.email\}/)
    expect(src).toMatch(/userId=\{auth\.user\?\.id\}/)
  })

  it('invents no data of its own', () => {
    // A settings page that hardcodes a name or an email is a fabricated row.
    const src = read(accountPath)
    expect(src).not.toMatch(/Math\.random/)
    expect(src).not.toMatch(/sample|mock|fake|fixture/i)
  })
})

describe('the shared account page supports the admin role', () => {
  const accountPage = read('src/components/advertiser/AccountPage.jsx')

  it('renders the role-specific panels only for that role', () => {
    // An admin has no advertisers or developer_accounts row, so those panels
    // must stay switched off rather than rendering empty fields.
    expect(accountPage).toMatch(/role === 'advertiser' \?/)
    expect(accountPage).toMatch(/role === 'developer' \?/)
  })

  it('patches only the profile table for a role with no side-table', () => {
    // Save must not send an advertiserPatch/developerPatch for an admin: there
    // is no row to update and the write would be a pointless attempt.
    expect(accountPage).toMatch(
      /advertiserPatch: role === 'advertiser' \?/
    )
    expect(accountPage).toMatch(
      /developerPatch: role === 'developer' \?/
    )
  })

  it('leaves the role column out of every profile write', () => {
    // `role` is never sent — the DB revokes UPDATE on it. A settings page that
    // could edit its own role would be a privilege-escalation surface.
    const saveApi = read('src/lib/accountApi.js')
    expect(saveApi).toMatch(/[`'"]role[`'"]\s+is\s+never\s+sent/)
    const profilePatch = saveApi.slice(
      saveApi.indexOf('saveAccountProfile'),
      saveApi.indexOf('saveAccountProfile') + 2000
    )
    expect(profilePatch).not.toMatch(/role:\s*role\b/)
  })
})