/* Every runtime effect the landing page needs, mounted once against the
   .landing root and fully torn down by the returned cleanup. StrictMode
   double-invokes effects, so each block must be independently removable:
   anything it appends to the DOM is appended in the cleanup, every listener
   is removed, every observer is disconnected. */

/* ── reveal ─────────────────────────────────────────────────────── */
function revealFx(root) {
  const items = [].slice.call(root.querySelectorAll('[data-reveal]'));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || typeof IntersectionObserver !== 'function') {
    items.forEach((el) => el.classList.add('is-in'));
    return () => {};
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add('is-in');
      io.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
  items.forEach((el) => io.observe(el));
  return () => io.disconnect();
}

/* ── graph-paper crosshair (hero only) ───────────────────────────── */
function axisFx(root) {
  const face = root.querySelector('#heroFace');
  const axis = face && face.querySelector('.axis');
  const cross = axis && axis.querySelector('.axis-cross');
  const tagX = axis && axis.querySelector('.axis-tag--x');
  const tagY = axis && axis.querySelector('.axis-tag--y');
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!axis || reduced || !fine) return () => {};

  let raf = null;
  let x = 0;
  let y = 0;
  let on = false;

  const paint = () => {
    raf = null;
    axis.style.setProperty('--ax', x.toFixed(1) + 'px');
    axis.style.setProperty('--ay', y.toFixed(1) + 'px');
    if (tagX) tagX.textContent = 'x ' + String(Math.round(x)).padStart(4, '0');
    if (tagY) tagY.textContent = 'y ' + String(Math.round(y)).padStart(4, '0');
    if (cross) cross.style.setProperty('--ax', x.toFixed(1) + 'px');
    if (cross) cross.style.setProperty('--ay', y.toFixed(1) + 'px');
    if (!on) {
      on = true;
      document.documentElement.classList.add('axis-on');
    }
  };

  const off = () => {
    if (!on) return;
    on = false;
    document.documentElement.classList.remove('axis-on');
  };

  const move = (e) => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    const t = e.target;
    if (!(t && face.contains(t))) {
      off();
      return;
    }
    const r = axis.getBoundingClientRect();
    x = e.clientX - r.left;
    y = e.clientY - r.top;
    if (!raf) raf = requestAnimationFrame(paint);
  };

  document.addEventListener('pointermove', move, { passive: true });
  document.addEventListener('mouseleave', off, { passive: true });
  return () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('mouseleave', off);
    if (raf) cancelAnimationFrame(raf);
    off();
  };
}

/* ── cursor ring ─────────────────────────────────────────────────── */
function ringFx(root) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return () => {};

  const el = document.createElement('div');
  el.className = 'cursor-ring';
  el.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);

  const hero = root.querySelector('#heroFace');
  let raf = null;
  let px = -100;
  let py = -100;
  let hot = false;
  let body = false;
  let picking = false;
  let lastTarget = null;
  let lastPick = null;
  let lastHot = null;
  let offTimer = null;

  const place = () => {
    raf = null;
    el.style.transform = 'translate3d(' + px.toFixed(2) + 'px,' + py.toFixed(2) + 'px,0)';
  };

  const setPicking = (on) => {
    if (on) {
      if (offTimer) {
        clearTimeout(offTimer);
        offTimer = null;
      }
      if (picking) return;
      picking = true;
      el.classList.add('pick');
      return;
    }
    /* Armed once, never re-armed: re-arming makes this a delay from the
       last call, which keeps the lens lit while the mouse keeps moving. */
    if (offTimer || !picking) return;
    offTimer = setTimeout(() => {
      offTimer = null;
      picking = false;
      el.classList.remove('pick');
    }, 110);
  };

  const clear = () => {
    el.classList.remove('on', 'hot', 'body');
    hot = false;
    body = false;
    setPicking(false);
    lastTarget = null;
  };

  const move = (e) => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    if (hero && e.target && (e.target === hero || (e.target.closest && e.target.closest('#heroFace')))) {
      clear();
      return;
    }
    px = e.clientX;
    py = e.clientY;
    if (!el.classList.contains('on')) el.classList.add('on');
    if (!raf) raf = requestAnimationFrame(place);

    const t = e.target;
    if (t !== lastTarget) {
      lastTarget = t;
      lastPick = t && t.closest ? t.closest('[data-pick]') : null;
      lastHot = t && t.closest ? t.closest('a,button,[data-spot]') : null;
    }
    setPicking(!!lastPick);
    const shouldBody = !lastPick;
    if (shouldBody !== body) {
      body = shouldBody;
      el.classList.toggle('body', body);
    }
    const shouldHot = !!lastHot && !lastPick;
    if (shouldHot !== hot) {
      hot = shouldHot;
      el.classList.toggle('hot', hot);
    }
  };

  const leave = () => {
    el.classList.remove('on');
    hot = false;
    body = false;
    el.classList.remove('hot', 'body');
    setPicking(false);
  };

  const blur = () => setPicking(false);

  document.addEventListener('pointermove', move, { passive: true });
  document.addEventListener('mouseleave', leave, { passive: true });
  window.addEventListener('blur', blur);

  return () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('mouseleave', leave);
    window.removeEventListener('blur', blur);
    if (raf) cancelAnimationFrame(raf);
    if (offTimer) clearTimeout(offTimer);
    el.remove();
  };
}

/* ── copy buttons ────────────────────────────────────────────────── */
function copyFx(root) {
  const btns = [].slice.call(root.querySelectorAll('[data-copy]'));
  if (!btns.length) return () => {};

  const write = (text) => {
    if (window.isSecureContext && navigator.clipboard) {
      return navigator.clipboard.writeText(text).then(() => true, () => fallback(text));
    }
    return Promise.resolve(fallback(text));
  };

  /* file:// has no clipboard permission in most browsers, so a real
     selection + execCommand is the only path that works there. */
  const fallback = (text) => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (err) {
      return false;
    }
  };

  const offs = [];
  btns.forEach((btn) => {
    let timer = null;
    const onClick = () => {
      write(btn.getAttribute('data-copy')).then((ok) => {
        /* Never claim a copy that did not happen. */
        if (!ok) return;
        btn.classList.add('is-copied');
        btn.textContent = 'Copied';
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          btn.classList.remove('is-copied');
          btn.textContent = 'Copy';
        }, 1700);
      });
    };
    btn.addEventListener('click', onClick);
    offs.push(() => {
      btn.removeEventListener('click', onClick);
      if (timer) clearTimeout(timer);
    });
  });

  return () => offs.forEach((fn) => fn());
}

/* ── sticky nav hairline ─────────────────────────────────────────── */
function navFx(root, doc) {
  const nav = root.querySelector('header.nav');
  if (!nav) return () => {};
  const hero = root.querySelector('#heroFace');

  const sync = () => nav.classList.toggle('stuck', window.scrollY > 8);
  window.addEventListener('scroll', sync, { passive: true });
  sync();

  /* The hero is the one light surface on the page, and the nav sits on top
     of it. The bar's own background is a translucent near-black, so over the
     hero it composites to a mid grey -- and the near-white links it inherits
     from the dark palette vanish into it. The stylesheet already carries an
     html.at-hero token override that repaints :root for exactly this case;
     nothing was ever setting the class, so the whole block was dead. Toggle
     it from an observer rather than from scroll position: the hero's bottom
     edge is where the change should happen, and a threshold on scrollY is
     only equivalent when the hero happens to be full-height. */
  let io = null;
  if (hero && typeof IntersectionObserver === 'function') {
    io = new IntersectionObserver(
      (entries) => doc.documentElement.classList.toggle('at-hero', entries[0].isIntersecting),
      { rootMargin: '-124px 0px 0px 0px', threshold: 0 },
    );
    io.observe(hero);
  } else if (hero) {
    const fallback = () =>
      doc.documentElement.classList.toggle('at-hero', hero.getBoundingClientRect().bottom > 124);
    window.addEventListener('scroll', fallback, { passive: true });
    window.addEventListener('resize', fallback);
    fallback();
    return () => {
      window.removeEventListener('scroll', sync);
      window.removeEventListener('scroll', fallback);
      window.removeEventListener('resize', fallback);
      doc.documentElement.classList.remove('at-hero');
    };
  }

  return () => {
    window.removeEventListener('scroll', sync);
    if (io) io.disconnect();
    doc.documentElement.classList.remove('at-hero');
  };
}

/* ── spotlight on [data-spot] cells ──────────────────────────────── */
function spotFx(root) {
  const cells = [].slice.call(root.querySelectorAll('[data-spot]'));
  if (!cells.length) return () => {};
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (!fine) return () => {};

  const moves = cells.map((cell) => {
    const on = (e) => {
      const r = cell.getBoundingClientRect();
      cell.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      cell.style.setProperty('--my', (e.clientY - r.top) + 'px');
    };
    cell.addEventListener('pointermove', on, { passive: true });
    return () => cell.removeEventListener('pointermove', on);
  });
  return () => moves.forEach((fn) => fn());
}

/* ── in-page anchors ─────────────────────────────────────────────── */
function anchorFx(root) {
  const links = [].slice.call(root.querySelectorAll('a[href^="#"]'));
  if (!links.length) return () => {};
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* scrollIntoView({behavior:'smooth'}) hands the duration and the curve to
     the browser: on a short hop it is over in two frames and reads as a
     jump, and there is no way to tune it. A rAF glide gives every link the
     same easing and a duration that scales with the distance travelled, so
     a link that moves 14px and one that moves 4,000px feel like the same
     gesture. */
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  let raf = null;
  const glide = (from, to) => {
    if (raf) cancelAnimationFrame(raf);
    const dist = Math.abs(to - from);
    if (reduced || dist < 2) { window.scrollTo(0, to); raf = null; return; }
    const dur = Math.min(1100, Math.max(480, dist * 0.34));
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      window.scrollTo(0, from + (to - from) * easeInOut(p));
      if (p < 1) raf = requestAnimationFrame(step); else raf = null;
    };
    raf = requestAnimationFrame(step);
  };
  const offs = links.map((a) => {
    const on = (e) => {
      const id = a.getAttribute('href').slice(1);
      if (!id) return;
      const target = root.querySelector('#' + CSS.escape(id));
      if (!target) return;
      e.preventDefault();
      glide(window.scrollY, window.scrollY + target.getBoundingClientRect().top);
    };
    a.addEventListener('click', on);
    return () => a.removeEventListener('click', on);
  });
  return () => {
    if (raf) cancelAnimationFrame(raf);
    offs.forEach((fn) => fn());
  };
}

export function landingFx(root) {
  const cleanups = [revealFx(root), axisFx(root), ringFx(root), copyFx(root), navFx(root, document), spotFx(root), anchorFx(root), marqueeFx(root, document), magneticFx(root)];
  document.documentElement.classList.add('landing-on');
  return () => {
    document.documentElement.classList.remove('landing-on');
    cleanups.forEach((fn) => fn());
  };
}

/* ── drag a box, leave a note ─────────────────────────────────────
   Desktop only: on touch the same gesture has to out-prioritise page
   scroll, and touch-action can only pick one. The hero is the only
   surface that supports it — the ring and the crosshair both hand over
   the pointer there, so this is the one place a left-drag means
   something other than a text selection. */
const NOTE_KEY = 'clirevenue.note.v1';
const NOTE_MIN_W = 250;
const NOTE_MIN_H = 122;

function marqueeFx(root, doc) {
  const hero = root.querySelector('.cube-face--hero');
  const box = root.querySelector('#marquee');
  const note = root.querySelector('#note');
  const input = root.querySelector('#noteInput');
  const warn = root.querySelector('#noteWarn');
  const saved = root.querySelector('#noteSaved');
  const clean = root.querySelector('#noteClean');
  const closeBtn = root.querySelector('#noteClose');
  if (!hero || !box || !note || !input) return () => {};

  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!fine || still) return () => {};

  const ce = doc.documentElement;
  const live = { x: 0, y: 0, w: 0, h: 0, ready: false };
  let dragging = false;
  let ox = 0; let oy = 0; let cx = 0; let cy = 0;
  let past = false;
  const isClick = (w, h) => w < 14 && h < 10;
  const clamp = (v, max) => (v < 0 ? 0 : v > max ? max : v);

  /* terms are assembled from fragments so the page source never holds the
     words themselves; letters may be separated by anything a person can type
     between them, or the filter is trivially defeated */
  const SEP = '[\\s.*_\\-~]*';
  const BAD = ['fa' + 'nk', 'sh' + 'it', 'bi' + 'tch', 'ass' + 'hole', 'ba' + 'stard', 'di' + 'ck'];
  const BAD_SRC = BAD.map((w) => w.split('').join(SEP)).join('|');
  const BAD_RE = new RegExp(BAD_SRC, 'gi');
  /* the hit test needs its own non-global regex: a /g/ RegExp carries
     lastIndex between calls and alternates catch and miss */
  const BAD_TEST = new RegExp(BAD_SRC, 'i');

  function applyNote() {
    const before = input.value;
    const after = before.replace(BAD_RE, (m) => m.replace(/[^\s]/g, '*'));
    if (after !== before) input.value = after;
    const hit = BAD_TEST.test(input.value);
    if (warn) warn.textContent = hit ? 'Some of that was starred out.' : '';
    if (clean) clean.hidden = !hit;
    return after;
  }

  /* Every storage access is wrapped: localStorage throws outright on some
     file:// origins and one throw here would take the whole page with it. */
  const store = {
    ok() {
      try { window.localStorage.setItem('__clr', '1'); window.localStorage.removeItem('__clr'); return true; }
      catch (e) { return false; }
    },
    read() {
      try { const r = window.localStorage.getItem(NOTE_KEY); return r ? JSON.parse(r) : null; }
      catch (e) { return null; }
    },
    write(v) {
      try { window.localStorage.setItem(NOTE_KEY, JSON.stringify(v)); return true; }
      catch (e) { return false; }
    },
    drop() {
      try { window.localStorage.removeItem(NOTE_KEY); return true; } catch (e) { return false; }
    },
  };

  function save() {
    if (!live.ready || !store.ok()) return false;
    const wrote = store.write({
      v: 1,
      box: { x: live.x, y: live.y, w: live.w, h: live.h },
      open: !note.hidden,
      text: input.value,
    });
    /* never claim a save we did not get */
    if (saved) saved.hidden = !wrote;
    return wrote;
  }

  function place() {
    let x = Math.min(ox, cx);
    let y = Math.min(oy, cy);
    let w = Math.abs(cx - ox);
    let h = Math.abs(cy - oy);
    if (isClick(w, h)) return false;
    w = Math.max(w, Math.min(NOTE_MIN_W, hero.offsetWidth));
    h = Math.max(h, Math.min(NOTE_MIN_H, hero.offsetHeight));
    x = clamp(x, Math.max(0, hero.offsetWidth - w));
    y = clamp(y, Math.max(0, hero.offsetHeight - h));
    live.x = x; live.y = y; live.w = w; live.h = h;
    box.style.width = w + 'px';
    box.style.height = h + 'px';
    box.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
    if (!note.hidden) {
      note.style.width = w + 'px';
      note.style.height = h + 'px';
      note.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
    }
    return true;
  }

  function restore() {
    const v = store.read();
    if (!v || v.v !== 1 || !v.box) return;
    const x = Number(v.box.x); const y = Number(v.box.y);
    const w = Number(v.box.w); const h = Number(v.box.h);
    if (!isFinite(x) || !isFinite(y) || !isFinite(w) || !isFinite(h)) return;
    if (isClick(w, h)) return;
    ox = x; oy = y; cx = x + w; cy = y + h;
    /* restore into marquee-set, never marquee-on: a saved box is not a drag */
    ce.classList.add('marquee-set');
    note.hidden = true;
    place();
    if (v.open) {
      note.hidden = false;
      input.value = typeof v.text === 'string' ? v.text : '';
      applyNote();
      place();
    }
  }

  function closeNote() {
    note.hidden = true;
    input.value = '';
    if (warn) warn.textContent = '';
    if (clean) clean.hidden = true;
    if (saved) saved.hidden = true;
    ce.classList.remove('marquee-set');
    box.style.width = '0px';
    box.style.height = '0px';
    live.x = 0; live.y = 0; live.w = 0; live.h = 0;
    store.drop();
  }

  function local(e) {
    const r = hero.getBoundingClientRect();
    const sy = r.height / hero.offsetHeight || 1;
    return { x: e.clientX - r.left, y: (e.clientY - r.top) / sy };
  }

  function down(e) {
    if (dragging || e.button !== 0) return;
    const t = e.target;
    if (!t || !t.closest) return;
    if (!t.closest('.cube-face--hero')) return;
    if (t.closest('a,button,textarea,input')) return;
    if (e.cancelable) e.preventDefault();
    const p = local(e);
    dragging = true;
    ox = cx = p.x;
    oy = cy = p.y;
    past = false;
    ce.classList.remove('marquee-set');
    ce.classList.add('marquee-on');
  }

  function move(e) {
    if (!dragging) return;
    const p = local(e);
    cx = p.x;
    cy = p.y;
    if (!past && !isClick(Math.abs(cx - ox), Math.abs(cy - oy))) past = true;
    /* hide the note on the first real travel, not on the bare press, so a
       stray click never blinks the annotation */
    if (past && !note.hidden) note.hidden = true;
    place();
  }

  function up() {
    if (!dragging) return;
    dragging = false;
    ce.classList.remove('marquee-on');
    const w = Math.abs(cx - ox);
    const h = Math.abs(cy - oy);
    if (isClick(w, h)) {
      /* a click, not a drag: put the previous box back rather than
         collapsing one the reader already saved */
      if (live.w > 0) {
        ce.classList.add('marquee-set');
        ox = live.x; oy = live.y; cx = live.x + live.w; cy = live.y + live.h;
        place();
      } else {
        box.style.width = '0px';
        box.style.height = '0px';
      }
      return;
    }
    place();
    ce.classList.add('marquee-set');
    note.hidden = false;
    place();
    input.focus();
    save();
  }

  function onKey(e) {
    if (e.key === 'Escape' && !note.hidden) { closeNote(); }
  }

  input.addEventListener('input', function () { applyNote(); save(); });
  if (clean) {
    clean.addEventListener('click', function () {
      input.value = input.value.split(/\s+/).map((w) => (/[^\s*]/.test(w) ? '****' : w)).join(' ');
      applyNote();
      save();
    });
  }
  if (closeBtn) closeBtn.addEventListener('click', closeNote);
  hero.addEventListener('selectstart', function (e) { e.preventDefault(); });
  window.addEventListener('keydown', onKey);
  window.addEventListener('pointerdown', down, true);
  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);

  live.ready = true;
  restore();
  save();

  return function teardown() {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('pointerdown', down, true);
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', up, true);
    ce.classList.remove('marquee-on', 'marquee-set');
  };
}

export { marqueeFx };

/* A few invitation CTAs lean toward the pointer. Purely opt-in: the control
   must carry `.magnetic`. See SELECTOR below for what earns it. */
function magneticFx(root) {
  /* THE PLACEMENT RULE. A button that moves is a control whose hit target
     is no longer where it was drawn, so the class has to be spent, not
     sprayed. It is spent on INVITATIONS -- controls that take you somewhere
     you have not been, on a page whose entire job is to send you there:

       · the hero CTA and the closing CTA on the front page
       · the front page's header "Sign up"
       · "Install with npm" on the developer page
       · "Start advertising" in the advertiser hero and closing CTA

     and on nothing else. In particular it is NOT on:

       · a form submit or a step advance (AuthPages "Continue", the sign-in
         and sign-up submits). Pressing a target that slides out from under
         the cursor is a usability defect, not a flourish -- the pointer
         lands where the button was, and the click does nothing.
       · anything inside a dashboard. There the primary button is "Create
         key", "Run", "Save", "Activate": work, not invitation.
       · the page chrome. A drifting Sign up in a sticky header is worse
         than no drift, because the header is the one control a visitor
         aims at from anywhere on the page.
       · small or dense controls -- copy buttons, tab toggles, row actions
         -- where three pixels of travel is most of the target.

     The ring that blooms on hover is deliberately NOT scoped this way. It
     is painted behind the control and never moves it, so it can stay a
     cheap affordance on every boxed button; see chrome.css. What has to
     be scoped to the opt-in is the lift-neutraliser in that same file,
     because it exists only to make room for this drift.

     Two things this got wrong historically, both of which looked like "the
     effect is missing from some buttons" rather than like bugs:

     1. It walked the DOM once and closed over those elements. React
        re-creates the CTAs whenever the auth state settles, so any control
        swapped after mount had listeners on a detached node and did
        nothing. Delegation resolves the target at event time, so a
        re-render cannot orphan anything.
     2. The drift is written INLINE, and inline outranks every stylesheet
        declaration that is not !important -- which silently killed
        chrome.css's `:active` press. The press is folded into the same
        inline value so there is exactly one writer of `transform`. */
  /* NOT scoped to .clr-surface. The eight themed surfaces wrap themselves in
     .clr-surface, but the landing page does not -- it is its own token host
     and owns the light hero. A `.clr-surface .lbtn` selector therefore never
     matched a single button on the landing, which is exactly the "the
     buttons have a different animation on this page" report. Querying the
     bare class sidesteps the question: both hosts mount this, and the
     opt-in travels with the markup. */
  const SELECTOR = '.magnetic';
  const TEXT_ONLY = new Set(['adv-link', 'nav-links', 'form__note', 'sdk-inline', 'clr-subnav']);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return () => {};
  const doc = root.ownerDocument || document;
  const strength = 0.28;
  const radius = 90;
  const PRESS = 'scale(.978) translateY(1px)';
  let cur = null;
  let held = false;
  let px = 0;
  let py = 0;
  /* A control with no box of its own is a text-style control. */
  const boxy = (el) => {
    const classes = (el.className || '').toString().split(/\s+/);
    for (const c of classes) if (TEXT_ONLY.has(c)) return false;
    if (el.closest('.nav-links')) return false;
    if (el.closest('.clr-subnav')) return false;
    const r = el.getBoundingClientRect();
    return r.height >= 30 && r.width >= 60;
  };
  const resolve = (t) => {
    if (!t || !t.closest) return null;
    const el = t.closest(SELECTOR);
    if (!el || !root.contains(el)) return null;
    return boxy(el) ? el : null;
  };
  const paint = () => {
    if (!cur) return;
    const r = cur.getBoundingClientRect();
    const dx = px - (r.left + r.width / 2);
    const dy = py - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy);
    if (d > radius) { cur.style.transform = held ? PRESS : ''; return; }
    const f = 1 - d / radius;
    cur.style.transform = (held ? PRESS + ' ' : '') +
      'translate3d(' + (dx * strength * f).toFixed(2) + 'px,' + (dy * strength * f * 1.15).toFixed(2) + 'px,0)';
  };
  const onMove = (e) => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    const el = resolve(e.target);
    if (el !== cur) {
      if (cur && !held) cur.style.transform = '';
      cur = el;
      held = false;
    }
    if (!cur) return;
    px = e.clientX;
    py = e.clientY;
    paint();
  };
  const onDown = (e) => {
    const el = resolve(e.target);
    if (el && el === cur) { held = true; paint(); }
  };
  const onUp = () => {
    if (!held) return;
    held = false;
    paint();
  };
  doc.addEventListener('pointermove', onMove, { passive: true });
  doc.addEventListener('pointerdown', onDown, { passive: true });
  window.addEventListener('pointerup', onUp, { passive: true });
  window.addEventListener('pointercancel', onUp, { passive: true });
  return () => {
    doc.removeEventListener('pointermove', onMove);
    doc.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    if (cur) cur.style.transform = '';
    cur = null;
  };
}
