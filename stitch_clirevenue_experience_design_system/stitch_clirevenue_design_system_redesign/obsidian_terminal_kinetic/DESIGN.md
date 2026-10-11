---
name: Obsidian Terminal Kinetic
colors:
  surface: '#10131a'
  surface-dim: '#10131a'
  surface-bright: '#363941'
  surface-container-lowest: '#0b0e15'
  surface-container-low: '#191b23'
  surface-container: '#1d1f27'
  surface-container-high: '#272a32'
  surface-container-highest: '#32353d'
  on-surface: '#e1e2ec'
  on-surface-variant: '#c2c6d7'
  inverse-surface: '#e1e2ec'
  inverse-on-surface: '#2d3038'
  outline: '#8c90a0'
  outline-variant: '#424655'
  surface-tint: '#b0c6ff'
  primary: '#b0c6ff'
  on-primary: '#002d6e'
  primary-container: '#558dff'
  on-primary-container: '#002661'
  inverse-primary: '#0058ca'
  secondary: '#ecb2ff'
  on-secondary: '#520071'
  secondary-container: '#cf5cff'
  on-secondary-container: '#480063'
  tertiary: '#00daf3'
  on-tertiary: '#00363d'
  tertiary-container: '#009fb2'
  on-tertiary-container: '#002f35'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#d9e2ff'
  primary-fixed-dim: '#b0c6ff'
  on-primary-fixed: '#001945'
  on-primary-fixed-variant: '#00429b'
  secondary-fixed: '#f8d8ff'
  secondary-fixed-dim: '#ecb2ff'
  on-secondary-fixed: '#320047'
  on-secondary-fixed-variant: '#74009f'
  tertiary-fixed: '#9cf0ff'
  tertiary-fixed-dim: '#00daf3'
  on-tertiary-fixed: '#001f24'
  on-tertiary-fixed-variant: '#004f58'
  background: '#10131a'
  on-background: '#e1e2ec'
  surface-variant: '#32353d'
typography:
  display-xl:
    fontFamily: Geist
    fontSize: 56px
    fontWeight: '700'
    lineHeight: 64px
  display-xl-mobile:
    fontFamily: Geist
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
  headline-lg:
    fontFamily: Geist
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
  headline-lg-mobile:
    fontFamily: Geist
    fontSize: 26px
    fontWeight: '600'
    lineHeight: 34px
  headline-md:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-sm:
    fontFamily: Geist
    fontSize: 20px
    fontWeight: '500'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 26px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
  label-code-lg:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
  label-code-md:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
  label-code-xs:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '600'
    lineHeight: 14px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-desktop: 1.5rem
  margin: 1rem
  margin-tablet: 2rem
  margin-desktop: 3rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

This design system establishes a high-performance, developer-first monetization ecosystem engineered for terminal tools, language model plugins, and autonomous coding agents. The design fuses the stark, high-density minimalism of advanced developer consoles with the electric kinetic accents inspired by basement.studio and Japanese cyber-editorial aesthetics.

The visual narrative centers around a deep void backdrop punctuated by the spectral energy of the mark: a razor-sharp blend of electric cobalt, hyper-cyan, and ultraviolet magenta. The interface rejects consumer SaaS fluff in favor of dense data fidelity, precision monospaced operational status indicators, and surgical micro-interactions. Every pixel communicates production-grade reliability, telemetry accuracy, and developer autonomy.

## Colors

The palette is anchored by the deep spatial hierarchy of obsidian neutrals and animated by the chromatic spectral gradient of the logomark:

- **Primary (`#2979FF`)**: Electric Cobalt. Used for dominant interactive states, key CTA vectors, terminal focus brackets, and active syntax indicators.
- **Secondary (`#BD00FF`)**: Radiant Ultraviolet. Applied to secondary conversion moments, dynamic telemetry highlights, and gradient terminal paths.
- **Tertiary (`#00E5FF`)**: Pure Hyper-Cyan. Deployed as high-visibility signal lights, active system beacons, latency badges, and cursor carets.
- **Neutral Canvas (`#0A0D14`)**: Void Canvas. Paired with tiered surface layers:
  - Surface Tier 1 (Background): `#0A0D14`
  - Surface Tier 2 (Card / Panel): `#0F1420`
  - Surface Tier 3 (Raised / Terminal Well): `#161D2E`
  - Border Base: `#1E293B`
  - Border Active: `#334155`
  - Text Dominant: `#F8FAFC`
  - Text Muted: `#94A3B8`
  - Text Dimmed: `#475569`

Gradient sequences strictly blend linearly at 135° from `#00E5FF` through `#2979FF` to `#BD00FF` to mirror the signature isometric glyph.

## Typography

The typographic architecture matches the dual nature of developer workflows: structural prose and strict machine feedback.

- **Headlines (`Geist`)**: Used across displays and section headers. Neutral, sharp, and razor-engineered with tight negative tracking (`-0.03em`) on display sizes to mirror technical editorial title design.
- **Body (`Inter`)**: Delivers supreme legibility for runtime logs, multi-tenant documentation, balance sheets, and transaction parameters.
- **Monospace Labels (`JetBrains Mono`)**: Mandated for API endpoints, revenue tokens, license keys, latency indicators, timestamp metrics, and command-line scripts. All figures default to tabular formatting (`tnum`).

## Layout & Spacing

The layout model enforces strict horizontal and vertical alignments based on a disciplined 4px base increment. 

- **Grid Architecture**: A 12-column structural layout for desktop (`>1024px`) shifting into an 8-column configuration for tablet (`768px - 1023px`), and a single-to-two column fluid stack on mobile (`<767px`).
- **Telemetry Density**: Content layouts leverage high-information packaging. Spacing favors deliberate precision over sprawling white space: horizontal gaps between status keys and values stay locked between `space-xs` and `space-sm`.
- **Canvas Boundaries**: Outer viewports incorporate structural framing lines—subtle vertical alignment dividers running along the grid margins to evoke a wireframe terminal canvas.

## Elevation & Depth

Visual hierarchy does not rely on diffuse, soft drop shadows. Depth is achieved through a combination of crisp container boundaries, gradient borders, and localized luminescent glow:

- **Level 0 (Canvas Base)**: Pure `#0A0D14`. Background overlay features an ultra-faint 24px isometric or orthogonal grid (`rgba(255, 255, 255, 0.02)`).
- **Level 1 (Panels & Workspaces)**: `#0F1420` surrounded by a structural 1px border (`#1E293B`). Zero shadow.
- **Level 2 (Active Terminal Cards & Modals)**: `#161D2E` with high-contrast perimeter tracing (`#334155`). On active state, the border transforms into a directional gradient (`#00E5FF` to `#BD00FF`) with a concentrated 12px blur perimeter (`rgba(41, 121, 255, 0.15)`).
- **Level 3 (Overlays & Command Palette)**: `#0F1420` backed by `backdrop-filter: blur(16px)` and illuminated with an inner edge highlight (`inset 0 1px 0 rgba(255, 255, 255, 0.08)`).

## Shapes

The design system adopts a controlled, minimal curvature model (`roundedness: 1`), providing standard UI containers with a 4px corner radius (`0.25rem`), medium modules with 8px (`0.5rem`), and large structural overlays with 12px (`0.75rem`).

This tight rounding preserves the crisp, computational sharpness inherent to CLI and terminal interfaces while avoiding the aggressive harshness of raw 0px corners. Interactive badges, syntax pill flags, and status dots may use fully round geometries (`9999px`) purely to signify real-time status pulses.

## Components

### Buttons & Command Triggers
- **Primary Action**: Solid `#2979FF` base with `#FFFFFF` label, or dual gradient fill (`#2979FF` to `#BD00FF`). Border-radius: 4px. Focus state triggers a 2px outer offset ring in `#00E5FF`.
- **Ghost/Terminal Trigger**: Transparent canvas with a 1px border in `#1E293B` and label in `JetBrains Mono`. On hover, the border illuminates to `#334155` with text shifting to `#F8FAFC`.
- **Destructive**: Bordered in `rgba(239, 68, 68, 0.4)` with an alert-red text fill; glows to full opacity on engagement.

### Metric Cards & Revenue Monitors
- Built using `#0F1420` surface with 1px border `#1E293B`.
- Features an integrated top telemetry bar showing real-time ping, API quota usage, or token yield in `label-code-xs`.
- Sparklines and charts employ neon strokes (`#00E5FF` or `#BD00FF`) against a low-contrast linear grid.

### Terminal Inputs & Code Fields
- Inset container (`#0A0D14`) with a persistent `$` or `>` command prompt glyph in `#00E5FF`.
- Font family strictly locked to `JetBrains Mono`.
- Active focus state renders a high-contrast 1px border in `#2979FF` and a flashing vertical block caret.

### Checkboxes, Radios & Switches
- Micro-scaled (16x16px) with 2px corner radius.
- Inactive state: `#0A0D14` fill with `#334155` border.
- Selected state: Filled with `#2979FF`, displaying a sharp, non-rounded vector checkmark in `#0A0D14`.

### Badges & Runtime Status Flags
- Monospaced typography with tight vertical padding (`space-xs` horizontal `space-sm`).
- Built with 10% opacity color fills backed by a 1px border of matching hue:
  - Cyan (`#00E5FF`): System Active / Agent Online
  - Cobalt (`#2979FF`): Settlement Processing
  - Magenta (`#BD00FF`): Tier 1 Revenue Yield