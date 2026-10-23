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
  billing: <Icon d="M3 7.5A2.5 2.5 0 0 1 5.5 5h13A2.5 2.5 0 0 1 21 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5v-9Zm2 1v2h14v-2H5Zm0 4v2.5h9V12.5H5Z" />,
  wallet: <Icon d="M0 3a2 2 0 0 1 2-2h13.5a.5.5 0 0 1 0 1H15v2a1 1 0 0 1 1 1v8.5a1.5 1.5 0 0 1-1.5 1.5h-12A2.5 2.5 0 0 1 0 12.5zm1 1.732V12.5A1.5 1.5 0 0 0 2.5 14h12a.5.5 0 0 0 .5-.5V5H2a2 2 0 0 1-1-.268M1 3a1 1 0 0 0 1 1h12V2H2a1 1 0 0 0-1 1" />,
  account: <Icon d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4.4 0-8 2.2-8 5v1h16v-1c0-2.8-3.6-5-8-5Z" />,
  sun: <Icon d="M12 2.25a.75.75 0 01.75.75v2.25a.75.75 0 01-1.5 0V3a.75.75 0 01.75-.75zM7.5 12a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM18.894 6.166a.75.75 0 00-1.06-1.06l-1.591 1.59a.75.75 0 101.06 1.061l1.591-1.59zM21.75 12a.75.75 0 01-.75.75h-2.25a.75.75 0 010-1.5H21a.75.75 0 01.75.75zM17.834 18.894a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 10-1.061 1.06l1.59 1.591zM12 18a.75.75 0 01.75.75V21a.75.75 0 01-1.5 0v-2.25A.75.75 0 0112 18zM7.758 17.303a.75.75 0 00-1.061-1.06l-1.591 1.59a.75.75 0 001.06 1.061l1.591-1.59zM3 12a.75.75 0 01.75-.75H6a.75.75 0 010 1.5H3.75A.75.75 0 013 12zM6.166 6.586a.75.75 0 00-1.06 1.06l1.59 1.591a.75.75 0 001.061-1.06l-1.59-1.591z" />,
  moon: <Icon d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />,
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
