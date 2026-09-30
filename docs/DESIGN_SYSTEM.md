# CLIRevenue Design System

Canonical visual + component standard for every surface (public site, auth, dashboards).
Source of truth for tokens is `src/index.css`. This document defines *how they are used*.

---

## 1. Palette — HARD CONTRACT

| Token | Value | Role |
|---|---|---|
| `--cli-black` | `#000000` | Environment: every background, panel, input fill |
| `--cli-white` | `#FFFFFF` | Information: type, structure, icons |
| `--cli-red` | `#FF1F2D` | Emphasis: primary actions, active state, warnings, instrumentation |

Rules:

- **No other UI colors.** No gray surfaces, no gradients in non-approved hues, no colored glows/shadows.
- Secondary text = white alpha (`rgba(255,255,255,.6–.78)`), never a gray hex.
- Depth comes from transparency, hairlines (`--hair`), perspective, and motion — never from a lighter panel color.
- **Logo exemption:** company/CLI marks keep native brand colors (Claude `#D97757`, Gemini `#5B8DEF`, Aider `#14B014`, OpenCode `#4B4646/#B7B1B1`). Their color must not leak into surrounding UI.
- Red fill ⇒ white text (contrast 4.5:1+). Small canvas chips may keep black text on red.

## 2. Typography

| Level | Family token | Scale token | Use |
|---|---|---|---|
| Display | `--font-display` (Orbitron) | `--display-xl/-l` | Hero / film chapter titles only |
| Section title | `--font-body` (Space Grotesk) 700 | `--display-m/-s` | `block__title`, page heads |
| Body | `--font-body` 400 | 16–18px | paragraphs, max `--measure` |
| Metadata / labels | `--font-mono` (IBM Plex Mono) | 11–13px | `.eyebrow`, `stat__label`, table headers |
| Technical data | `--font-mono` | 13–14px | numbers, terminal output, ledger rows |

- Mono = technical/data only. Never a full page of mono prose.
- Uppercase + `--track-label` (0.18em) only on instrument labels (eyebrows, table heads, buttons ≤2 words).
- **Eyebrow rule (landing):** max 1 eyebrow per 3 sections. Chapter markers (`01 — THE WAIT`) are functional instrumentation tied to the scroll rail and are exempt as a family; decorative eyebrows above every block head are banned — `SectionHead` therefore renders an eyebrow only when explicitly asked (dashboards keep theirs as page labels).

## 3. Geometry & spacing

- `--radius: 0px` — **one radius scale: all-sharp.** Circles allowed only for status dots / cursors (`50%`).
- Borders: `--border-w` 1px structural, 2px for emphasis (red rule on ad plates), 3px focus/active.
- Spacing scale: `--u` 4px base; section padding `clamp(56px, 9vh, 120px)`; gutter `--gutter`.
- Content width: one system — `--measure` 1180px for film scenes, 1240px for console/conv, dashboard shell max 1360px. Never a fourth.
- Hairline grids use `gap: 1px` + `background: var(--hair)` — always audit the collapsed (mobile) state for accidental horizontal rules.

## 4. Components

| Component | Rule |
|---|---|
| `.btn` + `--primary/--ghost/--sm/--danger` | The only button family. Primary = red fill / white label. Ghost = white hairline border. Every button: `:active` translate −1px, WCAG AA label, single-line label at desktop. |
| `Panel` → `.adv-panel` | Rectangular, 1px white hairline or none, `#000` fill, 24px pad. No nesting of `adv-panel` inside `adv-panel` (double pad is a bug). |
| Inputs | Black fill, white hairline, label ABOVE input, error BELOW, focus = red ring (`:focus-visible` global). |
| Tables | `.adv-table` / `.camps` — header mono uppercase, rows hairline-separated, mobile: stacked cards with `data-label` (never horizontal scroll for ≤4-column tables). |
| Status | Dot + label (`CAMPAIGN_STATUSES`), dot red when active/spend, white when idle. No colored badges beyond red/white. |
| Tabs / nav | `.adv-nav__btn`: underline active, no pills. Sticky bar may not wrap into 2+ rows — compact at ≤640. |
| Modals | `.dangertz-modal` — Escape closes, focus trapped, focus returned on close. |
| Empty / loading / error | `AdvEmpty`, `AdvLoading`, `AdvError` — skeleton shapes, never bare spinners. |

## 5. Motion

- Three stacks coexist and must all keep working: GSAP+ScrollTrigger+Lenis (film/drum), `motion/react` (`whileInView` reveals), CSS `clir-*` (loops/states).
- Animate `transform`/`opacity` only. Each animation must answer: hierarchy? sequence? feedback? state?
- Reduced motion honored at: `MotionConfig reducedMotion="user"`, `index.css` media block, `App.css` ×2, `usePrefersReducedMotion` (drum fallback).
- No new `window.scroll` listeners — Atmosphere's rAF-throttled writer is the sole existing exception.
- The drum may stay cinematic; nothing else loops infinitely.

## 6. Breakpoints

`1080 / 1000 / 900 / 760 / 640` (existing). New rules must declare their `<768px` collapse explicitly. `body overflow-x: hidden` is a safety net, not a license.

## 7. Voice

- User-facing copy: product language only. **Never** expose internals (table names, RLS, service-role, Supabase mechanics) in UI copy — comments and error-details screens excepted.
- One register per page. No invented metrics. Error copy always offers a next action.
- CTA labels: one label per intent across the page (login intent = "Log in", signup intent = "Sign up").
