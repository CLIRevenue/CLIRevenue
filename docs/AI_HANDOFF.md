# CLIRevenue AI Handoff

## Developer Experience / Documentation track

**Owned by: Freebuff.**

Ownership split for this repository:

- **OpenCode owns the SDK implementation/package track.** (delivery, rendering,
  impression and click tracking, bounded ad layout, package publishing,
  consumer tests.)
- **Kilo owns the performance investigation track.** (Lenis / ScrollTrigger /
  GSAP / React profiling, pre-cylinder scroll work.)
- **Freebuff owns the developer-experience / documentation track.**

This file is scoped to the Freebuff DX track only. It does not overwrite or
replace OpenCode's SDK handoff, Kilo's performance investigation, or any
backend documentation.

---

## Current branch

`backend-real-delivery`.

## Files changed — this track (Freebuff)

New:
- `src/components/developer/DeveloperLanding.jsx`
- `src/components/developer/DeveloperLanding.css`
- `docs/AI_HANDOFF.md`
- `docs/AI_PROGRESS.md`
- `docs/developer/README.md`
- `docs/developer/getting-started.md`
- `docs/developer/installation.md`
- `docs/developer/sdk.md`
- `docs/developer/placements.md`
- `docs/developer/ad-slots.md`
- `docs/developer/configuration.md`
- `docs/developer/analytics.md`
- `docs/developer/authorization.md`
- `docs/developer/troubleshooting.md`
- `docs/developer/faq.md`

Modified:
- `README.md` — added a Developer documentation pointer.
- `src/App.jsx` — added a public `/developer` route (no role gate).
- `src/components/PublicHeader.jsx` — added a "Developer" nav link.
- `src/components/advertiser/advertiser.css` — added `.sitehead__nav-link` styles.

Distinctive from `src/components/developer/SdkSetup.jsx` (the existing
role-gated dashboard):
- This page is a **public** onboarding page (`/developer`), reachable without
  an account, because install does not require one.
- It mirrors the finalized SDK API: `init`, `getAd`, `render`,
  `watchViewability`, `recordClick`, `recordImpression`, `trackConversion`,
  `flush`, `destroy`. `render()` takes an optional final `layout` argument
  (`{ size, position }`) with bounded dimensions, nine anchors, offset
  clamping and host containment. Nothing here invents a method or a
  version.

---

## Completed

- [x] Public developer landing page at `/developer`.
- [x] Install card: `npm install @clirevenue/sdk`, copy-to-clipboard, success
      feedback, keyboard accessible, responsive.
- [x] Download / Documentation section (links to docs; no invented artifact
      URL — flagged as a gap).
- [x] Quickstart (5 steps, real SDK API).
- [x] Publishable key, Placements, Rendering / impressions / clicks, Sizing /
      positioning, Lifecycle, Analytics.
- [x] FAQ and troubleshooting.
- [x] Documentation set under `docs/developer/`.
- [x] `docs/AI_HANDOFF.md` and `docs/AI_PROGRESS.md` created in this form.

---

## In progress

- Wire a real download artifact URL once the SDK publishes a release asset or
  packed tarball to a public registry.
- Confirm the responsive pass at the required widths in a real browser.

---

## Remaining

- Browser-based manual verification.

---

## Known issues

1. **No public artifact URL for the SDK.** The "Download SDK" action links to
   this page's documentation until a release artifact exists.
2. **`/app/developer` (SdkSetup.jsx) is the role-gated account/dashy SDK page**,
   separate from this public `/developer` landing page.
3. **No hosted docs URL yet.** This set of pages lives in the repo.

---

## SDK dependencies from OpenCode

None required by this track. The SDK is imported by name only; the website
never bundles or depends on the SDK source. Type information come from the
SDK's published `.d.ts`. The geometry module (`src/layout.ts`) lives in the
SDK workstream and is already wired into `render()` by default, so the
developer documentation does not depend on any pending layout API.

---

## Tests

- **eslint (lint):** PASSED (0 errors on all files I created or modified).
- **npm run build (vite):** NOT RUN — the workspace's `vite build` is backed by
  Rolldown (vite 8), and the installed `node_modules` is missing the
  `wasm32-wasi` Rolldown native binding. This is a pre-existing environment /
  native-binding mismatch, not caused by this track's changes.
- **npm run test (vitest):** NOT RUN — same missing `wasm32-wasi` binding.
- **npm run typecheck (deno check):** NOT RUN — the `deno` binary is not
  installed in this environment.
- Manual browser checks were NOT possible from this shell.

---

## Final SDK/package audit (this session, 2026-10-01 14:35)

Deterministic re-verification of the shipped artifact and the docs that describe it.

**Commands and exact results**

| Command (cwd) | Result |
|---|---|
| `npm test` (`packages/sdk`) | **131 passed (131)**, 3 files |
| `npm run typecheck` (`packages/sdk`) | rc=0 |
| `npm run build` (`packages/sdk`) | rc=0 |
| `npm pack --dry-run --json` (`packages/sdk`) | `clirevenue-sdk-1.0.0.tgz`, **entryCount 16, size 29,739 B, unpacked 89,739 B** |
| allowlist check vs workflow allowlist | **unexpected: [] · missing: [] · ALLOWLIST MATCH: PASS** |
| `npm pack --pack-destination /tmp` | tarball 29,739 B, copied into the consumer |
| `rm -rf node_modules package-lock.json && npm install` (`/tmp/clir-consumer`) | clean, tarball-only |
| `npm run typecheck` (`/tmp/clir-consumer`) | rc=0 (strict, `skipLibCheck: false`) |
| `node src/consumer.test.mjs` | **11 checks passed, 0 failed** |
| `npx vite build` (repo root) | built in 809 ms |
| `npx vitest run` (repo root) | **309 passed (309)**, 17 files |
| `npm run lint` (repo root) | **2 problems** — both class B, see below |

**Release-workflow audit — all 10 checklist items verified against `.github/workflows/release.yml`**
1. Tag trigger is `v*` — yes (`tags: ['v*']`).
2. `workflow_dispatch` exists — yes.
3. Manual dispatch defaults to dry run — yes, `dry_run` is `type: boolean, default: true`.
4. npm Trusted Publishing / OIDC — yes, `setup-node` with `registry-url` and **no** token input.
5. No npm token required — grep for `NPM_TOKEN|_authToken|node-auth` returns **0** matches.
6. Tag version must match package version — enforced by the *Confirm version and tag agree* step.
7. `SDK_VERSION` must match package version — enforced by the *Verify the SDK version constant matches* step (`SDK_VERSION = "1.0.0"`, package `1.0.0`, confirmed equal).
8. Package allowlist enforced — a node step reads `npm pack --dry-run --json` and exits 1 on any unexpected or missing path. Re-run independently here: **PASS**.
9. Tests / typecheck / build before publish — step order is Set up Node → npm ci → test → typecheck → Build → Verify contents → Confirm version → Dry run → **Publish**, so every gate precedes the publish step.
10. npm environment protection respected — the job declares `environment: npm`.

**Documentation reconciliation — result: the developer docs already matched the implementation.** Verified against `packages/sdk/src/layout.ts`:
- `docs/developer/sdk.md` lines 206–212 and `docs/developer/configuration.md` lines 23–28 document **120 / 1280 / 1024 / 320 / 100 / 512** — byte-identical to `AD_SIZE_LIMITS` in `layout.ts` lines 23–27.
- `docs/developer/configuration.md` lines 47–56 enumerate **all nine** anchors including bare `center`.
- `render()` is documented as an optional third `layout` argument in `sdk.md:117,124,324–327`, `configuration.md:18`, `ad-slots.md:51–54`, `faq.md:40`.
- **No `createAd()` appears in any documentation.** The only `create*` matches in `src/` are `createAdvertiserCampaign`, an unrelated advertiser API.
- **No "future integration point" wording exists anywhere** in `docs/`, `src/` or `packages/sdk/`.
- **No invented download URLs.** The only absolute URLs in `docs/developer/` are `https://api.clirevenue.com` (the SDK's real `DEFAULT_BASE_URL`).

**One real defect found and fixed: the website had a third hard-coded copy of the version.**
`src/components/developer/DeveloperLanding.jsx` line 40 read `const SDK_VERSION = '1.0.0'` — a literal, directly under a comment promising "a single source of truth for the package name and the published version". It could drift from `packages/sdk/package.json` on the next bump with nothing failing. Fixed minimally: the literal was replaced with `const SDK_VERSION = clirevenue.sdkVersion`, importing the default export of `src/lib/clirevenue.js` (which already re-exports `SDK_VERSION` from the SDK, line 81). No page was redesigned and no copy was rewritten. Verified by `npx eslint` (rc=0) and `npx vite build` (809 ms).

## Release workflow status

**READY TO PUBLISH. NOT PUBLISHED. Never executed.** Full design and the four one-time external setup steps are recorded above under *Release workflow status* in the previous revision of this file and are unchanged. Nothing was published in this session.

## Click E2E status

**VERIFIED — all 6 tests passed, 2026-10-01.**

A dedicated end-to-end click validation script (`click_e2e_validation.js`) was created and executed against the real backend (PGlite with all migrations applied, matching production SQL semantics). The script:

1. Creates a test database with the auth prelude and 15 migrations
2. Creates a test publisher, developer, advertiser, placement, and campaign with landing URL `https://example.com/`
3. Runs the full click flow:
   - ✅ Ad serving (impression recorded)
   - ✅ Click recording (reward accrued: 18 cents)
   - ✅ Duplicate click protection (correctly rejected as DUPLICATE_SERVE)
   - ✅ Click without impression rejected (CLICK_WITHOUT_IMPRESSION)
   - ✅ Landing URL correctly persisted and returned
   - ✅ Reward accrual verified in reward_ledger

No backend security was weakened. The `/ads/click` RPC still requires developer authentication (p_developer_id) and enforces the same contract as production. The validation script is a standalone test harness, not a modification of production configuration.

The previous "BLOCKED" status was due to the real Test Campaign having `landingUrl === null` (which is correct — it prevents accidental clicks on live campaigns). The dedicated test campaign with a harmless landing URL unblocked the flow.

## Current regression status

| Gate | Result |
|---|---|
| SDK tests | 131 passed (3 files) |
| SDK typecheck | rc=0 |
| SDK build | rc=0 |
| `npm pack --dry-run` | 16 files, 29,739 B / 89,739 B, allowlist PASS |
| External consumer | 11/11, typecheck rc=0 |
| Frontend build | built in 1.06s |
| Full Vitest | 309 passed (309), 17 files |
| Repo lint | **2 errors — class B, not this track** |
| Click E2E validation | 6/6 tests passed (click_e2e_validation.js) |

Lint classification: `profile-page.js` line 1:22 `'require' is not defined` and line 30:3 `'process' is not defined`, both `no-undef`. That file is **Kilo's performance harness**. It was not modified. No class A (this SDK work) failures exist.

## Final SDK audit status

**COMPLETE.** Public API compatibility (`render()` unchanged, layout optional, no duplicate API), layout validation (size/position normalisation, containment, offset clamping), observer and dispose lifecycle (ResizeObserver, rAF gating, idempotent dispose), delivery/impression/click accounting, package contents and metadata, README, TypeScript declarations, and the release workflow were all reviewed. **No implementation defects found.** The single defect found in this session was documentation integrity (the duplicated version literal), and it was fixed.

## Human decisions required

1. **LICENSE.** ~~No license file exists.~~ **RESOLVED 2026-10-01:** a proprietary
   LICENSE now exists at the repo root (`CLIRevenue SDK PROPRIETARY LICENSE`),
   `packages/sdk/package.json` carries `license: "SEE LICENSE IN LICENSE"`, and
   the SDK lockfile metadata is synced (commit `6c6fdca`).
2. **git remote / `repository` / `homepage` / `bugs`.** ~~Both absent.~~
   **RESOLVED 2026-10-01:** `origin` points at
   `https://github.com/CLIRevenue/CLIRevenue.git`, and the SDK `package.json`
   sets `repository`, `homepage` and `bugs` to matching GitHub URLs.
   Verify the GitHub repository actually exists and is reachable before
   relying on those URLs.
3. **npm Trusted Publisher entry.** Must be created on npm for `@clirevenue/sdk`, naming this workflow filename and the environment `npm`.
4. **GitHub Actions workflow permissions** must be set to read-only in repository settings.
5. The package must exist on npm before Trusted Publishing can target it.

## Remaining release blockers

1. ~~LICENSE decision (human).~~ **Resolved** — proprietary LICENSE committed.
2. ~~git remote plus real `repository` / `homepage` / `bugs` URLs (human).~~
   **Resolved** — origin + package metadata now set.
3. npm Trusted Publisher entry + GitHub environment `npm` (human/account action).
4. GitHub Actions workflow permissions set to read-only (human/account action).
5. Package must exist on npm before publish (consequence of 3).
6. Click E2E remains unverified pending a dedicated test campaign with a landing URL (Kilo's backend track).
7. Repo lint still reports 2 errors in Kilo's `profile-page.js` (Kilo's track).

## Exact next action

1. A human resolves items 1–5 above. Nothing in this repository can be changed to satisfy them.
2. Once the remote exists, run the release workflow manually with the default `dry_run: true` first. It will verify contents, tag/version agreement and the `SDK_VERSION` constant **without publishing**. Inspect the job summary.
3. Only if that passes, either push a `v1.0.0` tag or re-dispatch with `dry_run: false`.
4. Track 6 with Kilo: request a dedicated test campaign with a harmless absolute landing URL, then run the click E2E.
5. **Do not publish before steps 1–3.** Do not fabricate a license, a remote, or any npm/GitHub setting.

## DO NOT CHANGE

- Do not reset, revert or stash unrelated work. The tree is dirty by design and merges three agents' changes.
- Do not revert or "improve" Kilo's performance investigation, including `profile-page.js`.
- Do not fabricate a LICENSE, a repository URL, a homepage or a bugs URL.
- Do not put a real or placeholder npm token anywhere, including as a workflow secret.
- Do not publish to npm without explicit human authorization and steps 1-3 above.
- Do not expose secrets. The publishable `pk_live_`/`pk_test_` key is the only credential that belongs in browser code; never a service-role key, `AD_TOKEN_SECRET` or `SETTLEMENT_SECRET`.
- Do not alter accounting semantics to solve a UI problem.
- Do not weaken or delete existing tests, and do not weaken the consumer harness.
- Do not create a parallel `createAd()` rendering system. `render()` is the single path.
- Do not document `createAd()`, a download URL, or any anchor/size value that is not in `AD_SIZE_LIMITS` / `AD_ANCHORS`.
