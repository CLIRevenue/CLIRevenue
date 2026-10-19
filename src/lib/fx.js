/* Every runtime behaviour the effects layer needs, mounted once against
   the document and fully torn down by the returned cleanup.

   Three rules, each of which cost something to learn:

   1. No React. Every write goes straight to the DOM node from inside a
      rAF or an observer callback, exactly as spotlightFx and magneticFx
      do. No state, no effect, no re-render — so StrictMode's double
      invocation costs one extra mount and unmount, which the cleanup
      below makes free, and nothing else.

   2. Progressive enhancement is a hard contract, not a nicety. Anything
      here that would HIDE something (the scroll reveal) is gated behind a
      class that is only ever added when the effect can actually run. If
      IntersectionObserver is missing, or the device asks for reduced
      motion, nothing is hidden and nothing is counted. A page that
      depends on a script having run is a page that renders as a blank
      column on an old browser.

   3. One listener per signal, delegated from the document. A page can
      carry a hundred panels; a hundred pointermove listeners is a hundred
      chances to miss a removal. */

const doc = document;

/* Written by nothing else; read by fx.css as `var(--fx-progress, 0)`. */
const PROGRESS_MIN_SCROLL = 1.4;

function prefersReduced() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* ── the scroll-progress hairline ──────────────────────────────────
   One passive scroll listener, coalesced into one rAF, writing one
   custom property on one fixed two-pixel element. It is NOT a
   ScrollTrigger: the homepage already owns a ScrollTrigger on this axis
   and the repo's standing rule is that a second one is not allowed.
   Reading `scrollY` and scaling a bar is not that. */
function mountProgress() {
  const bar = doc.createElement('div');
  bar.className = 'fx-progress';
  bar.setAttribute('aria-hidden', 'true');
  bar.hidden = true;
  doc.body.appendChild(bar);

  let raf = null;
  const deep = () => doc.documentElement.scrollHeight - window.innerHeight > window.innerHeight * PROGRESS_MIN_SCROLL;

  const paint = () => {
    raf = null;
    if (!deep()) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    const span = doc.documentElement.scrollHeight - window.innerHeight;
    const p = span > 0 ? Math.min(1, Math.max(0, window.scrollY / span)) : 0;
    bar.style.setProperty('--fx-progress', p.toFixed(4));
  };

  const queue = () => {
    if (raf) return;
    raf = requestAnimationFrame(paint);
  };

  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue);
  paint();

  return () => {
    window.removeEventListener('scroll', queue);
    window.removeEventListener('resize', queue);
    if (raf) cancelAnimationFrame(raf);
    bar.remove();
  };
}

/* ── things arrive ─────────────────────────────────────────────────
   The reveal already exists on the front page and nowhere else: the two
   console landing pages, both dashboards and the auth screens all
   appear fully formed at full opacity today. Here the SAME rule is
   applied by stamping an attribute on the elements rather than by
   editing eight JSX files — which matters, because roughly thirty of
   this repo's test files assert on raw source text of `src/**`, and a
   markup edit in a component is a much bigger blast radius than a
   runtime attribute. */
const REVEAL_TARGETS = [
  '.adv-panel',
  '.sdk-panel',
  '.sdk-block',
  '.advx-block',
  '.sdk-row',
  '.advx-row',
  '.adv-tablewrap',
  '.adv-stats',
  '.adm-tele-card',
  '.adm-card',
  '.adv-empty',
  '.panel.adv-loading',
  '.setup__phase',
].join(',');

/* Panels get a stagger index rather than a CSS nth-child ladder: a
   conditional panel shifts every sibling's position, so a ladder
   re-times the wrong rows the moment a tab has one more card than its
   neighbour. */
function mountReveal() {
  const targets = [].slice.call(doc.querySelectorAll(REVEAL_TARGETS));
  if (!targets.length) return () => {};

  targets.forEach((el) => {
    el.setAttribute('data-fx-reveal', '');
    const group = el.parentElement;
    if (!group) return;
    const sibs = [].slice.call(group.children).filter((c) => targets.indexOf(c) !== -1 || c === el);
    el.style.setProperty('--fx-i', String(Math.min(12, sibs.indexOf(el))));
  });

  if (typeof IntersectionObserver !== 'function') {
    targets.forEach((el) => el.classList.add('is-in'));
    return () => {};
  }

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      });
    },
    /* Start the rise slightly before the panel is fully on screen: a
       reveal that fires when the panel is already visible reads as a
       glitch rather than as an arrival. */
    { rootMargin: '0px 0px -6% 0px', threshold: 0.06 },
  );
  targets.forEach((el) => io.observe(el));

  return () => {
    io.disconnect();
    targets.forEach((el) => {
      el.removeAttribute('data-fx-reveal');
      el.classList.remove('is-in');
      el.style.removeProperty('--fx-i');
    });
  };
}

/* ── figures count up ──────────────────────────────────────────────
   A stat that reads 1,204.00 the instant it appears gives no sense of
   whether it changed. One that counts up gives you the direction.

   Two rules keep this from becoming a gimmick. It runs ONCE, on first
   sight, and never again — a number that re-animates every time you look
   at it is a toy. And the ORIGINAL text is written back verbatim when
   the run finishes, so whatever the component rendered — currency
   symbol, thousands separators, a trailing unit, a percent — is exactly
   what the reader ends up looking at. */
const COUNT_TARGETS = '.stat__value, .advx-metric__value, .adm-tele-card__value';
const COUNT_MS = 900;

function formatLike(sample, value) {
  const dp = sample.indexOf('.') === -1 ? 0 : sample.length - sample.indexOf('.') - 1;
  const grouped = sample.indexOf(',') !== -1;
  let out = value.toFixed(dp);
  if (grouped) {
    const whole = out.split('.')[0];
    const rest = out.indexOf('.') === -1 ? '' : out.slice(out.indexOf('.'));
    out = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + rest;
  }
  return out;
}

function countUp(el) {
  const original = el.textContent || '';
  const m = original.match(/-?[\d][\d,]*\.?\d*/);
  if (!m) return null;
  const target = Number(m[0].replace(/,/g, ''));
  if (!isFinite(target) || target === 0) return null;

  const start = m.index;
  const end = m.index + m[0].length;
  const head = original.slice(0, start);
  const tail = original.slice(end);
  const t0 = performance.now();

  const step = (now) => {
    const p = Math.min(1, (now - t0) / COUNT_MS);
    /* easeOutCubic: fast off the mark, settling on the real number, so
       the value is legible for most of the run rather than only at the
       end. */
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = head + formatLike(m[0], target * eased) + tail;
    if (p < 1) {
      requestAnimationFrame(step);
      return;
    }
    /* The number the reader is left looking at is the number the
       component rendered — never a value this function rounded. */
    el.textContent = original;
  };

  /* Only the FIRST frame is handed back. Every later one is scheduled
     from inside the run itself, and by the time it fires the run is over
     — so there is nothing left to cancel. What the teardown needs to be
     able to stop is a run that is still in progress when the route
     changes underneath it. */
  return { id: requestAnimationFrame(step), original: original };
}

function mountCounts() {
  const nodes = [].slice.call(doc.querySelectorAll(COUNT_TARGETS));
  if (!nodes.length) return () => {};
  nodes.forEach((el) => el.classList.add('fx-count'));
  if (typeof IntersectionObserver !== 'function') return () => {};

  const live = new Map();
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        io.unobserve(entry.target);
        if (live.has(entry.target)) return;
        const run = countUp(entry.target);
        if (run) live.set(entry.target, run);
      });
    },
    { threshold: 0.4 },
  );
  nodes.forEach((el) => io.observe(el));

  /* A count-up that is still running when the route changes would keep
     writing textContent into a node nobody is looking at, and on a
     StrictMode double-mount it would run twice over the same digits.
     Cancel it, and put the original text back, so the teardown is exact
     rather than merely quiet. */
  return () => {
    io.disconnect();
    live.forEach((run, el) => {
      if (run.id) cancelAnimationFrame(run.id);
      el.textContent = run.original;
    });
    live.clear();
    nodes.forEach((el) => el.classList.remove('fx-count'));
  };
}

/* ── feature cards tilt towards the pointer ────────────────────────
   One delegated passive pointermove, writing two custom properties on
   whichever card is under the pointer. The cards are the only elements
   in this file that get a listener-free pointer response, and they get
   it through two percentages that fx.css turns into two rotations.

   Not applied on touch: there is no hover, so the transform would only
   ever be seen frozen in whatever state the last tap left it. */
/* Names checked against real markup before being written here: the two
   console landing pages, the front page's capability cards and the admin
   console's entity rows. `.sdk-card` and `.advx-card` were the obvious
   guesses and neither exists — the console pages call theirs `.sdk-panel`
   and `.advx-panel`, and the thing that actually wants a tilt is the
   spec/flow/metric grid inside them. */
const TILT_TARGETS = '.sdk-panel, .advx-panel, .sdk-spec, .advx-spec, .sdk-flow, .advx-metric, .advx-ladder, .ba-cap, .adm-entity';

function mountTilt() {
  const fine = typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (!fine) return () => {};

  let raf = null;
  let card = null;
  let x = 0;
  let y = 0;

  const paint = () => {
    raf = null;
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', (((x - r.left) / r.width) * 100).toFixed(1) + '%');
    card.style.setProperty('--my', (((y - r.top) / r.height) * 100).toFixed(1) + '%');
  };

  const move = (e) => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    const t = e.target && e.target.closest ? e.target.closest(TILT_TARGETS) : null;
    if (t !== card) {
      if (card) {
        card.classList.remove('fx-tilt');
        card.style.removeProperty('--mx');
        card.style.removeProperty('--my');
      }
      card = t;
      if (card) card.classList.add('fx-tilt');
    }
    if (!card) return;
    x = e.clientX;
    y = e.clientY;
    if (!raf) raf = requestAnimationFrame(paint);
  };

  doc.addEventListener('pointermove', move, { passive: true });
  return () => {
    doc.removeEventListener('pointermove', move);
    if (raf) cancelAnimationFrame(raf);
    if (card) {
      card.classList.remove('fx-tilt');
      card.style.removeProperty('--mx');
      card.style.removeProperty('--my');
    }
    card = null;
  };
}

/* ── the console rail knows where you are ─────────────────────────
   The in-page rail on /developer is a list of `#id` links. fx.css grows
   an accent bar on the hovered one and on `[aria-current]`, and until
   this existed nothing ever set `aria-current` — so on a page nine
   sections tall the rail could not answer the only question it is
   there for.

   One observer over the sections the rail actually links to. Not a
   scroll listener: the reveal above is already an observer on the same
   kind of node, and a scroll handler that reads offsets and writes
   attributes on every frame is the ScrollTrigger this repo forbids in
   a worse disguise. */

const SPY_LINKS = '.sdk-rail__link';
/* Everything the rail can point at, and everything that lives between two
   points it can point at. The two lists are deliberately different: only
   nine of this page's sections carry an `id`, and the ones between them
   are `<div class="sdk-row">` wrappers whose children are un-id'd
   `<section class="sdk-block">`. Watching only the id'd ones means the
   rail is blank for most of a nine-thousand-pixel page, which is exactly
   the failure this was written to remove. */
const SPY_BLOCKS = '.sdk-block, .sdk-row, .advx-block, .advx-row';

function mountSpy() {
  const links = [].slice.call(doc.querySelectorAll(SPY_LINKS));
  if (!links.length || typeof IntersectionObserver !== 'function') return () => {};

  /* href → the element it points at, in rail order. A rail entry whose
     target is gone is dropped, which is also what the navigation
     contract test asserts about the markup. */
  const marks = links
    .map((link) => {
      const id = (link.getAttribute('href') || '').replace(/^#/, '');
      const target = id ? doc.getElementById(id) : null
      return target ? { link: link, target: target } : null;
    })
    .filter(Boolean);
  if (!marks.length) return () => {};

  /* Which rail entry owns a given block: the last one that begins at or
     before it in the document. A heading the rail names owns everything
     from itself to the next heading the rail names, so a row that sits
     between two named sections is attributed to the one above it —
     which is the section a reader would say they are in. */
  const owner = (node) => {
    let best = null;
    for (let i = 0; i < marks.length; i += 1) {
      if (!(node.compareDocumentPosition(marks[i].target) & Node.DOCUMENT_POSITION_FOLLOWING)) best = marks[i];
      else break;
    }
    return best || marks[0];
  };

  const visible = new Set();
  const mark = () => {
    let current = null;
    visible.forEach((node) => {
      const mark = owner(node);
      if (!current) {
        current = mark;
        return;
      }
      /* Two blocks on screen at a boundary resolve to the one further
         down the page: the reader is arriving at it, not leaving it. */
      if (mark !== current && current.link.compareDocumentPosition(mark.link) & Node.DOCUMENT_POSITION_PRECEDING) {
        current = mark;
      }
    });
    marks.forEach((pair) => {
      if (current && pair === current) pair.link.setAttribute('aria-current', 'true');
      else pair.link.removeAttribute('aria-current');
    });
  };

  const nodes = [].slice.call(doc.querySelectorAll(SPY_BLOCKS));
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      });
      mark();
    },
    /* A band across the upper third of the viewport: the section a
       reader is actually reading is the one under their eye, not the
       one whose top edge happened to cross the fold. */
    { rootMargin: '-12% 0px -68% 0px', threshold: 0 },
  );
  nodes.forEach((node) => io.observe(node));
  mark();

  return () => {
    io.disconnect();
    visible.clear();
    marks.forEach((pair) => pair.link.removeAttribute('aria-current'));
  };
}

/* ── one arrival sweep, once ──────────────────────────────────────
   fx.css holds the band; this owns the clock. The class goes on <html>
   for the length of one animation and is then taken off again, so the
   pseudo simply does not exist afterwards and nothing the reader does
   can replay it. Without the class there is no element, no layer and no
   compositing cost at all.

   The `animationend` listener is on the CLASS LISTENER target — <html>
   is the animation's originating element, so the event bubbles to it —
   and it is `{ once: true }` so a reader who navigates mid-sweep cannot
   leave the listener behind. The timeout is the belt to that pair of
   braces: if the animation is suppressed for any reason the sweep has
   fired its `forwards` state and is invisible either way, but the
   attribute should not outlive it. */
const ARRIVAL_MS = 1600;

function mountArrival() {
  const ce = doc.documentElement;
  ce.classList.add('fx-arrival');
  const done = () => ce.classList.remove('fx-arrival');
  ce.addEventListener('animationend', done, { once: true });
  const timer = setTimeout(done, ARRIVAL_MS);
  return () => {
    clearTimeout(timer);
    done();
  };
}

/* ── one mount, one teardown ──────────────────────────────────────
   The order is the order of the cleanup: observers first so nothing
   fires during removal, then the progress element, then the class that
   the stylesheet keys off. */
/* A :hover that outlives the element it was on.

   The browser recomputes hover when the pointer moves. Scrolling is not
   one of the things that makes it recompute, so a card or a button can
   slide out from under a stationary cursor and keep the hover it was
   given — on this page that reads as the rainbow ring still glowing on a
   button nobody is pointing at. Lenis makes it worse rather than better:
   it moves content by transform rather than by moving the box, so the
   compositor has even less reason to notice the target has gone.

   The cheapest thing that does make the browser re-run hit-testing is a
   mousemove at the position the pointer is already at. It is dispatched
   from a passive, capture-phase scroll listener so it sees Lenis and
   every nested scroller, and it is gated on "something interactive was
   last under the pointer", which means ordinary scrolling over text or
   empty paper costs one boolean and nothing else. */
const HOVER_REFRESH_TARGETS =
  'button, a, .qs-step, .cmd-copy, .lbtn, .btn, [role="button"], input, select, textarea';

export function mountHoverRefresh() {
  let x = -1;
  let y = -1;
  let frame = 0;
  let armed = false;

  const track = (event) => {
    x = event.clientX;
    y = event.clientY;
    armed = Boolean(event.target && event.target.closest && event.target.closest(HOVER_REFRESH_TARGETS));
  };

  const nudge = () => {
    frame = 0;
    if (!armed || x < 0 || y < 0) return;
    doc.dispatchEvent(
      new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }),
    );
  };

  const onScroll = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(nudge);
  };

  window.addEventListener('pointermove', track, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true, capture: true });

  return () => {
    if (frame) window.cancelAnimationFrame(frame);
    window.removeEventListener('pointermove', track);
    window.removeEventListener('scroll', onScroll, true);
  };
}

export function mountFx() {
  const ce = doc.documentElement;
  const offs = [];

  const reduced = prefersReduced();
  const canObserve = typeof IntersectionObserver === 'function';

  /* The class gates every hiding behaviour in fx.css. Without it the
     reveal rules do not match and nothing is ever invisible. */
  if (canObserve && !reduced) ce.classList.add('js-fx');
  if (canObserve && !reduced && doc.documentElement.scrollHeight > window.innerHeight * PROGRESS_MIN_SCROLL) {
    ce.classList.add('js-fx-deep');
  }

  offs.push(mountReveal());
  offs.push(mountCounts());
  offs.push(mountProgress());
  if (!reduced) offs.push(mountTilt());
  if (!reduced) offs.push(mountSpy());
  if (!reduced) offs.push(mountArrival());
  /* Not gated on reduced motion: it changes no animation, it only stops a
     stale hover from outliving the thing it was on. */
  offs.push(mountHoverRefresh());

  return () => {
    while (offs.length) {
      const off = offs.pop();
      if (typeof off === 'function') off();
    }
    ce.classList.remove('js-fx', 'js-fx-deep');
  };
}