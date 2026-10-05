/* =============================================================
   CLIRevenue — placement registry
   -------------------------------------------------------------
   Every virtual ad surface in this application resolves to exactly
   one placement key here, and nowhere else. A placement key is not
   something the browser may invent: it is chosen by the publisher when
   the placement row is created on the server, it is unique per
   publisher, and it has to already exist or `/ads/deliver` answers
   `INVALID_PLACEMENT`. So the keys live in one table, next to the
   surface they belong to, and a screen that has no entry here simply
   does not request an ad.

   Adding a surface means adding a row here and then creating the
   matching placement on the server with the same key. Nothing else in
   the codebase needs to change, and no component carries a key
   literal of its own.

   The `loading` and `noFill` strings are the words the slot speaks
   while it is waiting and when the server legitimately had nothing to
   sell. No fill is inventory, not failure: it is written to read like
   part of the interface, never like a bug.
   ============================================================= */

export const PLACEMENTS = {
  /* The one surface that requests a real ad. It sits inside the
     agent-session transcript in the console workbench, framed by the
     same `.placement-slot` markup as the film's scripted slot. */
  consoleWorkbench: {
    key: 'console-workbench',
    surface: 'console · workbench sponsored slot',
    selector: '.workbench .placement-slot--workbench',
    owner: 'src/components/console/ServedAdSlot.jsx',
    dimensions: {
      width: 'fluid — breaks out of the output column (margin 14px -24px)',
      height: 'content-driven — one rail row plus a 44px logo row',
    },
    viewability: {
      threshold: 0.5,
      dwellMs: 1000,
      note:
        'The SDK refuses to record an impression below 50% visibility for a full second. The slot is therefore never reported as delivered merely for existing in the DOM.',
    },
    loading: {
      headline: 'Requesting placement',
      support: 'CLIRevenue delivery in flight for this slot.',
    },
    noFill: {
      headline: 'No ad for this slot right now',
      support: 'No fill is a normal outcome. Nothing is imputed and nothing is charged.',
    },
    error: {
      headline: 'Placement request failed',
      support: 'The delivery endpoint rejected or could not answer the request.',
    },
    offline: {
      headline: 'Offline',
      support: 'Recorded events are queued and flush when the connection returns.',
    },
    disabled: {
      headline: 'Placement not configured',
      support: 'No publisher key is present in this build, so no ad is requested.',
    },
  },

  /* The film's ad and experience scenes each carry a real placement.
     Both are SDK-backed delivery surfaces with their own keys. They sit
     inside narrative scenes but they are not narrative content: each
     requests from the real delivery service, records impressions through
     the SDK, and supports click tracking.

     The ServedAdSlot for each is rendered as a child of the Terminal
     component, inside the output area, so the selector targets the
     .placement-slot element inside the scene's terminal output stream. */
  filmAd: {
    key: 'film-ad',
    surface: 'film · TheAd scene terminal slot',
    selector: '[data-scene="ad"] .terminal__out .placement-slot',
    owner: 'src/components/scenes/TheAd.jsx',
    dimensions: {
      width: 'fluid — inside the film terminal output column',
      height: 'content-driven — one rail row plus a 44px logo row',
    },
    viewability: { threshold: 0.5, dwellMs: 1000 },
    loading: {
      headline: 'Requesting placement',
      support: 'CLIRevenue delivery in flight for this slot.',
    },
    noFill: {
      headline: 'No ad for this slot right now',
      support: 'No fill is a normal outcome. Nothing is imputed and nothing is charged.',
    },
    error: {
      headline: 'Placement request failed',
      support: 'The delivery endpoint rejected or could not answer the request.',
    },
    offline: {
      headline: 'Offline',
      support: 'Recorded events are queued and flush when the connection returns.',
    },
    disabled: {
      headline: 'Placement not configured',
      support: 'No publisher key is present in this build, so no ad is requested.',
    },
  },

  filmExperience: {
    key: 'film-experience',
    surface: 'film · TheExperience scene terminal slot',
    selector: '[data-scene="experience"] .terminal__out .placement-slot',
    owner: 'src/components/scenes/TheExperience.jsx',
    dimensions: {
      width: 'fluid — inside the film terminal output column',
      height: 'content-driven — one rail row plus a 44px logo row',
    },
    viewability: { threshold: 0.5, dwellMs: 1000 },
    loading: {
      headline: 'Requesting placement',
      support: 'CLIRevenue delivery in flight for this slot.',
    },
    noFill: {
      headline: 'No ad for this slot right now',
      support: 'No fill is a normal outcome. Nothing is imputed and nothing is charged.',
    },
    error: {
      headline: 'Placement request failed',
      support: 'The delivery endpoint rejected or could not answer the request.',
    },
    offline: {
      headline: 'Offline',
      support: 'Recorded events are queued and flush when the connection returns.',
    },
    disabled: {
      headline: 'Placement not configured',
      support: 'No publisher key is present in this build, so no ad is requested.',
    },
  },

  /* The drum's reserved ad surface on the LOCAL/SELF-HOSTED panel.
     It sits inside the rotating WebGL cylinder and is positioned by
     the drum's animation loop via CSS transform. The ad lifecycle
     (delivery, viewability, click, cleanup) is owned entirely by
     DrumAdSlot.jsx, which delegates to the same useServedAd hook the
     other homepage slots use. The drum never touches delivery state.
     ============================================================= */
  consoleDrum: {
    key: 'console-drum',
    surface: 'console · drum LOCAL/SELF-HOSTED panel band',
    selector: '.orbit__ad .servedad',
    owner: 'src/components/console/DrumAdSlot.jsx',
    dimensions: {
      width: 'projected from the drum\'s reserved 428×100 tile band',
      height: 'projected — matches the painted band at the current angle',
    },
    viewability: { threshold: 0.5, dwellMs: 1000 },
    loading: {
      headline: 'Requesting placement',
      support: 'CLIRevenue delivery in flight for this slot.',
    },
    noFill: {
      headline: 'No ad for this slot right now',
      support: 'No fill is a normal outcome. Nothing is imputed and nothing is charged.',
    },
    error: {
      headline: 'Placement request failed',
      support: 'The delivery endpoint rejected or could not answer the request.',
    },
    offline: {
      headline: 'Offline',
      support: 'Recorded events are queued and flush when the connection returns.',
    },
    disabled: {
      headline: 'Placement not configured',
      support: 'No publisher key is present in this build, so no ad is requested.',
    },
  },

  /* The film's own slot is a scripted beat in a narrative scene, not
     a delivery surface: it has no campaign behind it, nothing to
     attribute, and it must keep working in a build with no publisher
     key at all. It is registered here so the map is complete and so
     nobody later mistakes it for an un-wired live surface. */
  filmSlot: {
    key: null,
    surface: 'film · terminal slot (scenes/TheAd, scenes/TheExperience)',
    selector: '.placement-slot',
    owner: 'src/components/AdSlot.jsx',
    delivery: false,
    reason:
      'Narrative. Content comes from src/data/demo.js, no request is made and no event is recorded.',
    dimensions: {
      width: 'fluid — inside the film terminal output column',
      height: 'content-driven — one rail row plus a 44px logo row',
    },
    viewability: { threshold: 0.5, dwellMs: 1000 },
    loading: { headline: 'Requesting placement', support: '' },
    noFill: { headline: 'No ad for this slot right now', support: '' },
    error: { headline: 'Placement request failed', support: '' },
    offline: { headline: 'Offline', support: '' },
    disabled: { headline: 'Placement not configured', support: '' },
  },
}

/* Only surfaces that actually deliver. `delivery: false` entries are
   documentation, not configuration. */
export const DELIVERED_PLACEMENTS = Object.values(PLACEMENTS).filter(
  (placement) => placement.delivery !== false && typeof placement.key === 'string',
)

export const DELIVERED_PLACEMENT_KEYS = DELIVERED_PLACEMENTS.map(
  (placement) => placement.key,
)

export default PLACEMENTS
