import '../advertiser/sidebar.css'

/* The developer rail, built on the console shell rather than a parallel one.

   The two consoles are the same product: a fixed column of pages, a header
   carrying the mark and the controls that are not destinations, and a foot
   with where you are, how your workspace is doing, and the way out. So this
   renders the same class names and therefore the same stylesheet —
   `sidebar.css` is imported above, once.

   The class names carry an `adv-` prefix that reads as "advertiser" and is
   in fact "console". That is debt, not a decision: renaming it means
   touching every rule in that file, and this change is worth more landed
   than renamed. Do not add new `adv-` names here — `dev-` is the
   direction. */

function Icon({ d }) {
  return (
    <svg className="adv-side__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  )
}

const GLYPH = {
  dashboard: <Icon d="M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z" />,
  earnings: <Icon d="M4 19h16v-2H4v2Zm2-4h3V9H6v6Zm5 0h3V5h-3v10Zm5 0h3v-8h-3v8Z" />,
  sdk: <Icon d="m8 6-6 6 6 6 1.4-1.4L4.8 12l4.6-4.6L8 6Zm8 0 1.4 1.4L12.8 12l4.6 4.6L16 18l6-6-6-6Z" />,
  keys: <Icon d="M14 7a4 4 0 1 1-3.9 4.9L4 18v2h3v-2h2v-2h2l1.1-1.1A4 4 0 0 1 14 7Zm2 2.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />,
  placements: <Icon d="M4 5h7v7H4V5Zm9 0h7v4h-7V5Zm0 6h7v8h-7v-8ZM4 14h7v5H4v-5Z" />,
  integrations: <Icon d="M10 4h4v3h3v4h-3v3h-4v-3H7V7h3V4Zm-5 9h4v4H5v-4Z" />,
  analytics: <Icon d="M5 20V10h3v10H5Zm5.5 0V4h3v16h-3ZM16 20v-7h3v7h-3Z" />,
  account: <Icon d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4.4 0-8 2.2-8 5v1h16v-1c0-2.8-3.6-5-8-5Z" />,
  wallet: <Icon d="M3 9v2h4v12h5V11h4V9H3Zm10 15v-5l-4-4-4 4v5Zm0-8V6l-4-4-4 4v10Z" />,
  referrals: <Icon d="M13 2L3 14h9l-1 8 10-12h-9l1-8Z" />,
  support: <Icon d="M12 2a9 9 0 0 0-9 9v6a3 3 0 0 0 3 3h2v-8H5v-1a7 7 0 1 1 14 0v1h-3v8h2a3 3 0 0 0 3-3v-6a9 9 0 0 0-9-9Z" />,
  sun: <Icon d="M12 8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 0 0 12 8.5Zm0-6.5 1.6 2.7h-3.2L12 2Zm0 20-1.6-2.7h3.2L12 22ZM2 12l2.7-1.6v3.2L2 12Zm20 0-2.7 1.6v-3.2L22 12ZM4.9 4.9 7.7 6v0L4.9 4.9Zm14.2 14.2L17 18v0l2.1 1.1ZM19.1 4.9 17 6v0l2.1-1.1ZM4.9 19.1 7 18v0l-2.1 1.1Z" />,
  moon: <Icon d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />,
}

export default function DeveloperSidebar({
  items,
  active,
  onNavigate,
  onOpenSettings,
  onOpenSupport,
  logoutSlot,
  theme,
  onToggleTheme,
  activeLabel,
  workspace,
}) {
  const dark = theme === 'dark'

  return (
    <aside className="adv-side" aria-label="Developer navigation">
      <div className="adv-side__head">
        <span className="adv-side__brand">
          <span className="adv-side__brand-cli">CLI</span>
          <span className="adv-side__brand-revenue">Revenue</span>
        </span>
        <span className="adv-side__head-tools">
          <button
            type="button"
            className="adv-side__icon-btn"
            onClick={onToggleTheme}
            aria-pressed={dark}
            aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
            title={dark ? 'Light' : 'Dark'}
          >
            {dark ? GLYPH.sun : GLYPH.moon}
          </button>
          <button
            type="button"
            className="adv-side__icon-btn"
            onClick={onOpenSettings}
            aria-haspopup="dialog"
            aria-label="Account settings"
            title="Account"
          >
            {GLYPH.account}
          </button>
        </span>
      </div>

      <nav className="adv-nav" aria-label="Developer pages">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="adv-nav__btn"
            aria-current={active === item.id ? 'page' : undefined}
            data-active={active === item.id}
            onClick={() => onNavigate(item)}
          >
            <span className="adv-nav__glyph">{GLYPH[item.icon] || GLYPH.dashboard}</span>
            <span className="adv-nav__label">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="adv-side__foot">
        <p className="adv-side__where" aria-live="polite">{activeLabel}</p>

        {workspace ? (
          <div className="adv-side__facts">
            <div className="adv-side__fact">
              <span className="adv-side__fact-k">Workspace</span>
              <span className="adv-side__fact-v">{workspace.name}</span>
            </div>
            <div className="adv-side__fact">
              <span className="adv-side__fact-k">Earnings</span>
              <span className="adv-side__fact-v">{workspace.balance}</span>
            </div>
            <div className="adv-side__fact">
              <span className="adv-side__fact-k">Wallet</span>
              <span className="adv-side__fact-v">{workspace.wallet}</span>
            </div>
            <div className="adv-side__fact">
              <span className="adv-side__fact-k">Entries</span>
              <span className="adv-side__fact-v">{workspace.entries}</span>
            </div>
          </div>
        ) : null}

        <button type="button" className="adv-side__row" onClick={onOpenSupport} aria-haspopup="dialog">
          <span className="adv-nav__glyph">{GLYPH.support}</span>
          <span className="adv-nav__label">Contact support</span>
        </button>

        <div className="adv-side__row adv-side__row--host">{logoutSlot}</div>
      </div>
    </aside>
  )
}
