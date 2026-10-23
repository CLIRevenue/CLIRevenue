import './sidebar.css'

/* ── icons ────────────────────────────────────────────────────────────
   Inline rather than pulled from a library: a handful of glyphs are not
   worth a dependency, and an <svg> inherits currentColor, which is the
   point — a glyph recolours with the surface it sits on, light or dark,
   with no second rule anywhere. */

function Icon({ d }) {
  return (
    <svg className="adv-side__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  )
}

const GLYPH = {
  overview: <Icon d="M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z" />,
  campaigns: <Icon d="M4 5h16v3H4V5Zm0 5.5h16v3H4v-3ZM4 16h10v3H4v-3Z" />,
  analytics: <Icon d="M5 19h14v2H5v-2ZM7 10h3v7H7v-7Zm4-4h3v11h-3V6Zm4 6h3v5h-3v-5Z" />,
  wallet: <Icon d="M20 5v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Zm-5 0v12M8 5v12M12 5v12M16 5v12" />,
  account: <Icon d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4.4 0-8 2.2-8 5v1h16v-1c0-2.8-3.6-5-8-5Z" />,
  /* Sun for what the toggle gives you, moon for what you are leaving —
     the only pairing that is unambiguous without a tooltip. */
  sun: <Icon d="M12 5V2M12 22v-3M5 12H2M22 12h-3M6.3 6.3 4.2 4.2M19.8 19.8l-2.1-2.1M6.3 17.7l-2.1 2.1M19.8 4.2l-2.1 2.1M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />,
  moon: <Icon d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />,
  support: <Icon d="M12 2a9 9 0 0 0-9 9v6a3 3 0 0 0 3 3h2v-8H5v-1a7 7 0 1 1 14 0v1h-3v8h2a3 3 0 0 0 3-3v-6a9 9 0 0 0-9-9Z" />,
}

/**
 * The advertiser rail: one column of the screen, holding the pages, the
 * mark, and the controls that are not pages.
 *
 * It is not resizable and does not collapse. A rail that can be dragged
 * between 72px and 420px spends a permanent part of the screen on an
 * axis nobody asked to change, and on a laptop that is a column of
 * content gone. 240px is what this rail's longest label — "Campaigns
 * Keys" on the developer side, "Campaigns" here — actually needs with
 * room to spare, so that is what it gets, and that is the end of it.
 *
 * The width is therefore a constant in the stylesheet rather than a
 * custom property written from here. There is nothing to remember, so
 * nothing is remembered.
 *
 * Three bands, top to bottom, and each answers a different question:
 * the head says whose account this is and offers the two switches that
 * apply to everything; the nav is where you go; the foot is what you came
 * to do and what you do when something is wrong.
 */
export default function AdvertiserSidebar({
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
    <aside className="adv-side" aria-label="Advertiser navigation">
      {/* The head is the one band that is not navigation, and it earns
          that: the mark says whose account you are in, and the two icons
          beside it are the switches that apply to the whole console
          rather than to any one page. Both are icons alone. A label on
          the theme control would have to read either "Dark" or "Light",
          and neither is true until you press it. */}
      <div className="adv-side__head">
        <span className="adv-side__brand">
          <span className="adv-side__brand-cli">CLI</span>
          <span className="adv-side__brand-revenue">Revenue</span>
        </span>
        <div className="adv-side__head-tools">
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
        </div>
      </div>

      <nav className="adv-nav" aria-label="Advertiser pages">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="adv-nav__btn"
            aria-current={active === item.id ? 'page' : undefined}
            data-active={active === item.id}
            onClick={() => onNavigate(item)}
          >
            <span className="adv-nav__glyph">{GLYPH[item.icon] || GLYPH.overview}</span>
            <span className="adv-nav__label">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="adv-side__foot">
        <p className="adv-side__where" aria-live="polite">
          {activeLabel}
        </p>

        {/* What this account is, not what this page is. The rail had room
            and nothing to say with it, which reads as unfinished rather
            than as spare. These are facts about the account — the
            workspace it belongs to and where its campaigns stand — and
            they are the things you want without having to go and look. */}
        {workspace ? (
          <div className="adv-side__facts">
            <p className="adv-side__fact">
              <span className="adv-side__fact-k">Workspace</span>
              <span className="adv-side__fact-v" title={workspace.name}>
                {workspace.name}
              </span>
            </p>
            <p className="adv-side__fact">
              <span className="adv-side__fact-k">Campaigns</span>
              <span className="adv-side__fact-v mono">{workspace.campaigns}</span>
            </p>
            <p className="adv-side__fact">
              <span className="adv-side__fact-k">Live</span>
              <span className="adv-side__fact-v mono">{workspace.active}</span>
            </p>
          </div>
        ) : null}

        {/* Support. A rail that can only get you to a page has nowhere to
            go when the thing you need is a person. */}
        <button
          type="button"
          className="adv-side__row"
          onClick={onOpenSupport}
          aria-haspopup="dialog"
        >
          <span className="adv-nav__glyph">{GLYPH.support}</span>
          <span className="adv-nav__label">Contact support</span>
        </button>

        {/* Logout arrives as a node from the app, because the rail is not
            allowed to own the session. It is a .adv-nav__btn inside
            someone else's row, so the row must not fight it for the box. */}
        <div className="adv-side__row adv-side__row--host">{logoutSlot}</div>
      </div>
    </aside>
  )
}
