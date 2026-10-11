# CLIRevenue Email Templates — Supabase Auth Configuration

## Overview

This directory contains production-ready HTML email templates for all five Supabase Auth transactional flows. Templates use a consistent premium light-theme design with the CLIRevenue light logo, restrained blue-violet gradients, polished typography, accessible CTA buttons, and mobile-friendly layouts.

## Templates

| File | Supabase Template | Subject Line |
|------|-------------------|--------------|
| `01-confirm-signup.html` | Confirm Signup | "Confirm your CLIRevenue account" |
| `02-invite-user.html` | Invite User | "You're invited to CLIRevenue" |
| `03-magic-link.html` | Magic Link | "Your CLIRevenue sign-in link" |
| `04-recovery.html` | Recovery (Password Reset) | "Reset your CLIRevenue password" |
| `05-email-change.html` | Email Change | "Confirm your new email address" |

## Design System

**Color Scheme (Light Theme Tokens from `src/index.css`):**
```css
/* Background */
--bg: #FAF9F6;
--surface: #F1F0F8;

/* Text */
--text: #171923;
--text-muted: #51576A;

/* Accents (restrained blue-violet-purple) */
--accent-blue: #2563EB;
--accent-violet: #7C3AED;
--accent-purple: #9333EA;
--signal: #2563EB;  /* Primary CTA */

/* Borders */
--hair: rgba(23, 25, 35, 0.12);
--border: rgba(23, 25, 35, 0.12);
```

**Typography:**
- Display/Headings: `Space Grotesk` (system-ui fallback stack)
- Body: `Space Grotesk`
- Mono/Code: `IBM Plex Mono` (ui-monospace fallback stack)

**CTA Buttons:**
- Gradient: `linear-gradient(90deg, #2563EB, #7C3AED)`
- Border-radius: `4px`
- Padding: `14px 32px`
- Font-weight: `600`
- White text on gradient
- Subtle hover brightening (progressive enhancement)

**Animation:**
- Single `fadeInUp` keyframe (0.4s, `cubic-bezier(0.19,1,0.22,1)`)
- Wrapped in `@media (prefers-reduced-motion: no-preference)`
- Email clients that strip `<style>` blocks render static fallback automatically

## Supabase Placeholder Variables

All templates preserve these required Supabase placeholders:
- `{{ .ConfirmationURL }}` — The action link (confirm, reset, accept, etc.)
- `{{ .Email }}` — Recipient's email address
- `{{ .SiteURL }}` — Configured site URL (used for asset URLs and footer links)

**Critical:** Never replace `{{ .ConfirmationURL }}` with the homepage URL. Each template's link serves a specific security flow.

## Asset URLs

Templates reference assets using `{{ .SiteURL }}` placeholder:
- Logo: `https://{{ .SiteURL }}/brand/clirevenue-logo-light.png` (48×47)
- Favicon: `https://{{ .SiteURL }}/brand/clirevenue-favicon-light.png`

**Production domain must be verified** in Supabase Dashboard → Authentication → URL Configuration before assets will load in delivered emails.

## Installation Instructions

### Via Supabase Dashboard (Recommended)

1. Open **Supabase Dashboard** → **Authentication** → **Email Templates**
2. For each of the 5 template types:
   - Click **Customize** / **Edit**
   - Copy the entire HTML content from the corresponding `.html` file
   - Paste into the template editor
   - Set the **Subject** line as specified in the table above
   - Click **Save**
3. Verify using the **Preview** button for each template

### Via Supabase CLI (Alternative)

```bash
# Note: Supabase CLI doesn't directly manage email templates.
# Use the Dashboard method above for reliable configuration.
```

## Verification Checklist

After configuration, test each flow:

- [ ] **Confirm Signup**: Sign up with a test email → check inbox → click link → lands on `/auth/callback` → session established
- [ ] **Invite User**: From admin console, invite a test email → check inbox → click link → lands on signup with prefilled email
- [ ] **Magic Link**: Request magic link for test email → check inbox → click link → signed in directly
- [ ] **Recovery**: Request password reset → check inbox → click link → lands on `/auth/callback?reset=1` → password reset form
- [ ] **Email Change**: In account settings, change email → check new inbox → click link → email updated

## Mobile Testing

Test in major email clients:
- [ ] Gmail (web, iOS, Android)
- [ ] Outlook (web, iOS, Android, Desktop)
- [ ] Apple Mail (iOS, macOS)
- [ ] Yahoo Mail (web)
- [ ] Proton Mail (web)

## Accessibility

- Semantic HTML structure with proper heading hierarchy
- Sufficient contrast ratios (WCAG AA minimum)
- Descriptive link text and button labels
- `lang="en"` attribute on `<html>`
- `alt` text on logo image
- `role="presentation"` on layout tables
- Reduced motion respected via media query

## Production Deployment Notes

1. **Production domain must be configured** in Supabase → Authentication → URL Configuration → Site URL
2. **Assets must be accessible** at `https://<production-domain>/brand/` (verify after deploy)
3. **Email templates are stored in Supabase Dashboard**, not in this repository
4. **Changes require manual Dashboard update** — no CI/CD sync for email templates

## File Locations

- Templates: `/email-templates/*.html`
- Logo assets: `/public/brand/clirevenue-logo-light.png`, `/public/brand/clirevenue-favicon-light.png`
- Design tokens reference: `/src/index.css` (`.light-theme` block)

## Version History

- **v1.0** (2026-10-09): Initial premium light-theme templates for all 5 flows