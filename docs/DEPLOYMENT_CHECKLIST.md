# Deployment Checklist

Scope: everything that must be true before the current branch is deployed, and
verified afterwards. Companion to [PRODUCTION_DEPLOYMENT_RUNBOOK.md](./PRODUCTION_DEPLOYMENT_RUNBOOK.md),
which explains *why* the ordering matters. This document is the checklist.

**Nothing in this repository has been deployed, committed, or pushed.** Every
statement below about production is either read from a file in this repo or
marked UNKNOWN, because this checkout is not linked to a Supabase project
(there is no `.supabase/` directory).

---

## 1. Before you deploy

### 1.1 Code state

- [ ] The working tree is clean, or every uncommitted change is accounted for.
      This tree is **not** clean: `git status --porcelain` lists many modified
      files from several agents' work, and an untracked `clirevenue.config.json`
      at the repository root that another tool created. Decide its fate before
      committing — see §5.
- [ ] `npm run typecheck` (root, `deno check`) exits 0.
- [ ] `npm run test:deno` exits 0.
- [ ] `npm run test:db` exits 0.
- [ ] `npx vitest run --exclude 'tests/db/**'` exits 0.
- [ ] `packages/cli`: `npm run typecheck`, `npm test`, `npm run build`,
      `npm pack --dry-run` all exit 0.
- [ ] CI is green on the branch. `.github/workflows/ci.yml` runs the four
      batteries above.

### 1.2 Secrets

Read the runbook §1 for the full table. The two that fail closed:

| Secret | State | Action |
| --- | --- | --- |
| `AD_TOKEN_SECRET` (>= 16 chars) | **UNKNOWN in production.** Not present in any local `.env*` except `.env.example`, and the `supabase/.temp/.supabase-output-test_secret-*` artifact is an empty directory. Production function secrets were not queried. | Confirm with `supabase secrets list`. See §4. |
| `SETTLEMENT_SECRET` | UNKNOWN | Confirm before deploying `settle_rewards`. Without it only the scoped developer path works. |

- [ ] `APP_ORIGINS` is restricted to real origins, not `*`.

### 1.3 Migrations

- [ ] Snapshot the database first. `supabase migration up` is not transactional
      across the whole run.
- [ ] Read runbook §2. `000011` must apply before `000015`.
- [ ] Decide what to do about `000012_remove_global_active_campaign.sql` — it is
      held back until the new `campaigns` function is live. There is no subset
      flag; the runbook gives the `mv`-aside procedure.
- [ ] Confirm whether the production database is at `000015` or later. This
      checkout's newest migration is `000023`; the runbook header was written
      when the newest was `000015` and has not been re-verified against
      production.

---

## 2. Deploy order

The runbook §3 is authoritative. In short:

1. Apply migrations through `000011`, with `000012` set aside.
2. Deploy `campaigns`.
3. Apply `000012`, restore the file.
4. Deploy the remaining functions.
5. Deploy `events`, which was undeployed as of the last check.

Steps 2–4 are one unit: `000011` changes the `apply_impression` signature, and
the old `record_impression` / `record_interaction` call the two-argument form.
Do not leave those two deployed across the `000011` apply.

---

## 3. Per-function JWT flags

Derived by reading each function's auth path, not by assumption. Re-verify
before deploying — a function whose auth path changed needs a different flag.

| Flag | Functions |
| --- | --- |
| `--no-verify-jwt` | `ads`, `get_active_campaign`, `settle_rewards` |
| default (gateway verifies) | `auth`, `campaigns`, `campaign_select`, `payouts`, `rewards`, `events`, `record_impression`, `record_interaction`, `delete_account` |

`settle_rewards` is dual-mode and is the easy one to get wrong: deploying it
with gateway verification makes the gateway reject secret-only callers before
the function runs, silently disabling platform-wide settlement with no error.

---

## 4. `AD_TOKEN_SECRET` rotation

State: **UNKNOWN — rotate if presence is found.**

Why it is unknown rather than absent. The audit removed a `test_secret` Edge
Function whose purpose was to return secret material. Its output artifact,
`supabase/.temp/.supabase-output-test_secret-TwDdOD/`, survives as an **empty
directory** — the output is gone, so its contents cannot be inspected, and an
empty directory is equally consistent with "nothing was written" and "output
was cleaned up". No local `.env*` file contains the variable except
`.env.example`, which is a template. Production function secrets are only
visible through the Supabase API and were not queried from this checkout.

Checklist:

- [ ] `supabase secrets list` — is `AD_TOKEN_SECRET` present?
- [ ] If **absent**: nothing to rotate. It was never provisioned, so the
      `test_secret` handler would have failed loudly. Record that and move on.
- [ ] If **present**:
  - [ ] Rotate it: `supabase secrets set AD_TOKEN_SECRET=<new, >= 16 chars>`.
  - [ ] Any caller presenting the old value loses ad serving until updated. The
        runbook §1 notes a Cursor API key exposed via `ps`; check for other
        callers before rotating.
  - [ ] Deploy `ads` after rotating, or it will serve with a stale value.
- [ ] `tests/security-invariants.test.js` passes, confirming no `test_secret`
      function or `secretPreview` / `secretLength` reference has come back.

---

## 5. Repository hygiene before committing

- [ ] The untracked `clirevenue.config.json` at the **repository root** is
      either added to `.gitignore` or deleted deliberately. It is a real config
      written by another tool, it is not ignored, and `git add -A` would
      commit it. It currently holds no credential.
- [ ] `.env`, `.env.local`, `.env.filebase` are ignored. `git status` shows none
      of them.
- [ ] No `*.tgz`, `*.backup`, `*.bak`, `*.rej`, or `*.orig` inside a package
      directory.
- [ ] `dist/` stays ignored. It is safe to ignore only because `prepack`
      rebuilds it — `prepackOnly` does **not** run on `npm pack`.
- [ ] Every agent's uncommitted work is reviewed rather than swept in with
      `git add -A`.

---

## 6. After deploying

- [ ] `npm view clirevenue version` matches the version you intended to ship.
      **Note:** `clirevenue@1.0.0` on npm is a pre-redesign snapshot. Until a
      newer version is published, `npx clirevenue setup` runs the old flow with
      placement presets and ad-size prompts.
- [ ] `clirevenue editor` finds the key in `.env.local`. The deployed function
      must accept the `x-clirevenue-publisher-key` header; a deployed `cli`
      function predating that change will not authenticate the CLI.
- [ ] `POST /cli/placements` responds. It is implemented in source and **not
      deployed**, so any flow that creates a placement fails against the
      deployed API.
- [ ] `supabase functions list` shows every function at the intended version.