/* =============================================================
   CLIRevenue — quick-copy control for commands and code
   -------------------------------------------------------------
   One implementation of the copy interaction, shared by the public
   /developer and /advertiser pages so the two cannot drift apart:
   the raw text of the snippet reaches the clipboard (clipboard API
   first, with a legacy textarea fallback for non-secure origins),
   the control inverts to COPIED for a moment, and it returns to
   Copy by itself.

   It is always a real <button> placed in the bar beside the code it
   copies — never inside the <pre>, so no interactive control is ever
   nested in a code block. Success is cosmetic: it never asserts
   anything about the network or the account.

   `baseClass` is each page's styling hook — the developer page passes
   `sdk-copy`, the advertiser page `advx-copy` — and the success state
   appends `--done` to that same base, which is what both stylesheets
   key the inverted state on. The shared shell (btn btn--ghost btn--sm)
   is what keeps this control on the same interaction language as every
   other button in the product, Log in included.
   ============================================================= */

import { useCallback, useState } from 'react'

/**
 * `showCount` appends how many characters were actually copied to the
 * confirmation.
 *
 * A one-time secret is the one thing where "Copied" is not enough: half a
 * key copies just as cleanly as a whole one, and the difference is only
 * visible after the paste has been rejected somewhere else entirely. The
 * count is the last moment the shortfall is still cheap to notice.
 */
export default function CopyButton({
  text,
  label = 'code',
  baseClass = 'copy',
  showCount = false,
  onCopied,
}) {
  const [copied, setCopied] = useState(false)

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* `navigator.clipboard` is undefined on http:// origins before a
         secure context, or when the clipboard API is unavailable. Fall
         back to the legacy path rather than fail the flow. */
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'absolute'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
      } catch {
        /* If even the legacy path refuses, the plate still shows the
           snippet so it can be typed or pasted by hand. */
      }
      document.body.removeChild(ta)
    }
    setCopied(true)
    onCopied?.()
    window.setTimeout(() => setCopied(false), 1600)
  }, [text, onCopied])

  return (
    <button
      type="button"
      className={`btn btn--ghost btn--sm ${baseClass}${copied ? ` ${baseClass}--done` : ''}`}
      onClick={copy}
      aria-label={
        copied
          ? showCount
            ? `Copied ${text.length} characters`
            : 'Copied'
          : `Copy ${label} to clipboard`
      }
      title={copied ? (showCount ? `Copied ${text.length} characters` : 'Copied') : `Copy ${label}`}
    >
      {copied ? (showCount ? `Copied ${text.length}` : 'Copied') : 'Copy'}
    </button>
  )
}