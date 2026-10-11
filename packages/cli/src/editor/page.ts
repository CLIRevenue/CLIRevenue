import { AD_ANCHORS, AD_SIZE_LIMITS, normalizeLayout, type AdLayout } from '../project/geometry.js';

/**
 * The placement editor page.
 *
 * Served from `127.0.0.1` by `clirevenue editor`. It is deliberately a single
 * self-contained HTML document with no build step and no third-party
 * dependency: it has to open instantly inside whatever editor the user
 * happens to be in, on a machine that may be offline from npm.
 *
 * What it does and does not do:
 *
 *   - It renders a *real* ad-sized box over a page-sized host, and that box is
 *     the same geometry the SDK will later resolve. Dragging it and saving
 *     produces `{ size, position }` for `render()` — there is no separate
 *     "demo" mode.
 *   - It never sees a credential. The page is handed placement keys and
 *     geometry only; saving posts back to the CLI, which owns the file
 *     writes. A compromised or curious browser tab cannot obtain the
 *     publisher key from here.
 *
 * Accessibility is a requirement, not a nicety: dragging is unusable with a
 * keyboard or a screen reader, so every draggable interaction has a numeric
 * equivalent (width, height, anchor, offset) and the box itself is focusable
 * with arrow-key nudging.
 */

/**
 * One ad the user can position, as the browser sees it.
 *
 * A slot belongs to an integration and inherits that integration's placement
 * key: many slots may share one key, which is what lets several ads sit on a
 * page without the backend ever seeing several placements. `integrationId`
 * travels alongside `slotId` because they are the only two things needed to
 * identify a slot unambiguously, and because the *owner* matters — saving a
 * slot must never be able to reach across into a sibling.
 */
export interface EditorSlot {
  integrationId: string;
  slotId: string;
  label: string;
  /** The backend placement this slot renders. Read-only in the browser. */
  placementKey: string;
  layout: AdLayout;
  container?: string;
  /** Disabled slots are listed but marked, so "disable" is visible not silent. */
  enabled: boolean;
}

/** One CLI integration, as the browser sees it. */
export interface EditorIntegration {
  id: string;
  label: string;
  target: string;
  placementKey: string;
  slots: EditorSlot[];
}

export interface EditorPageState {
  /** Random per-session secret; also the request token for the API. */
  token: string;
  integrations: EditorIntegration[];
  /** Which integration opens first. */
  selectedId: string | null;
  /** Width of the simulated host, used to resolve the box against. */
  hostWidth: number;
  hostHeight: number;
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );

export function renderEditorPage(state: EditorPageState): string {
  const payload = JSON.stringify({
    limits: AD_SIZE_LIMITS,
    anchors: AD_ANCHORS,
    integrations: state.integrations,
    selectedId: state.selectedId,
    host: { width: state.hostWidth, height: state.hostHeight },
  }).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CLIRevenue — placement editor</title>
<style>
  :root {
    --bg: #0e1014; --panel: #161a21; --line: #262c37; --text: #e6e9ef;
    --muted: #8b94a6; --accent: #6ea8fe; --accent-soft: #6ea8fe22; --danger: #ff8a8a;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text); height: 100vh;
    display: grid; grid-template-rows: auto 1fr auto;
    font: 14px/1.5 ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  header, footer {
    display: flex; gap: 16px; align-items: center; padding: 12px 18px;
    background: var(--panel); border-bottom: 1px solid var(--line);
  }
  footer { border-bottom: 0; border-top: 1px solid var(--line); justify-content: flex-end; }
  h1 { font-size: 14px; font-weight: 600; margin: 0; letter-spacing: .01em; }
  .sub { color: var(--muted); font-size: 12px; }
  main { display: grid; grid-template-columns: 1fr 260px; min-height: 0; }
  .stage { padding: 18px; overflow: auto; display: flex; }
  .host {
    position: relative; margin: auto; background: #12161d;
    border: 1px solid var(--line); border-radius: 8px; overflow: hidden;
  }
  .host-label {
    position: absolute; top: 6px; left: 8px; color: var(--muted); font-size: 11px;
    pointer-events: none; letter-spacing: .02em;
  }
  #ad {
    position: absolute; background: var(--accent-soft);
    border: 2px solid var(--accent); border-radius: 6px; cursor: grab;
    display: flex; align-items: center; justify-content: center;
    color: var(--accent); font-size: 12px; font-variant-numeric: tabular-nums;
    touch-action: none;
  }
  #ad:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
  #ad.dragging { cursor: grabbing; }
  .handle {
    position: absolute; width: 10px; height: 10px; background: var(--panel);
    border: 2px solid var(--accent); border-radius: 3px;
  }
  .handle.nw { left: -6px; top: -6px; cursor: nwse-resize; }
  .handle.ne { right: -6px; top: -6px; cursor: nesw-resize; }
  .handle.sw { left: -6px; bottom: -6px; cursor: nesw-resize; }
  .handle.se { right: -6px; bottom: -6px; cursor: nwse-resize; }
  aside { background: var(--panel); border-left: 1px solid var(--line); padding: 16px; overflow: auto; }
  label { display: block; font-size: 11px; color: var(--muted); margin: 12px 0 4px; text-transform: uppercase; letter-spacing: .05em; }
  input, select, button {
    font: inherit; color: var(--text); background: #0f131a; border: 1px solid var(--line);
    border-radius: 6px; padding: 7px 9px; width: 100%;
  }
  button { cursor: pointer; background: #1c222c; width: auto; padding: 8px 16px; }
  button.primary { background: var(--accent); color: #0b0e13; border-color: var(--accent); font-weight: 600; }
  button.ghost { background: transparent; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .hint { color: var(--muted); font-size: 11px; margin-top: 6px; }
  .err { color: var(--danger); font-size: 12px; min-height: 18px; margin-top: 8px; }
  .readout { font-variant-numeric: tabular-nums; }
  .visually-hidden {
    position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap;
  }
  @media (prefers-color-scheme: light) {
    :root { --bg:#f6f7f9; --panel:#fff; --line:#e2e5ea; --text:#12151b; --muted:#5c6473; --accent-soft:#6ea8fe26; }
  }
</style>
</head>
<body>
<header>
  <h1>CLIRevenue placement editor</h1>
  <span class="sub" id="subtitle">Pick a placement, then drag and resize the ad.</span>
</header>

<main>
  <div class="stage">
    <div class="host" id="host">
      <span class="host-label">page</span>
      <div id="ad" tabindex="0" role="application"
           aria-label="Ad placement box. Use arrow keys to move, or type exact values in the panel.">
        <span id="ad-text" class="readout">320 × 100</span>
        <span class="handle nw" data-dir="nw"></span>
        <span class="handle ne" data-dir="ne"></span>
        <span class="handle sw" data-dir="sw"></span>
        <span class="handle se" data-dir="se"></span>
      </div>
    </div>
  </div>

  <aside>
    <label for="placement">Placement</label>
    <select id="placement"></select>
    <p class="hint" id="placement-hint"></p>

    <div class="row">
      <div>
        <label for="width">Width (px)</label>
        <input id="width" type="number" inputmode="numeric">
      </div>
      <div>
        <label for="height">Height (px)</label>
        <input id="height" type="number" inputmode="numeric">
      </div>
    </div>
    <p class="hint" id="size-range"></p>

    <label for="anchor">Anchor</label>
    <select id="anchor"></select>

    <div class="row">
      <div>
        <label for="offsetX">Offset X (px)</label>
        <input id="offsetX" type="number" inputmode="numeric">
      </div>
      <div>
        <label for="offsetY">Offset Y (px)</label>
        <input id="offsetY" type="number" inputmode="numeric">
      </div>
    </div>

    <label for="container">Container selector</label>
    <input id="container" type="text" placeholder="#clirevenue-ad">
    <p class="hint">Where the ad renders in your app. Used by the static HTML adapter.</p>

    <p class="err" id="error" role="alert" aria-live="polite"></p>
  </aside>
</main>

<footer>
  <span class="sub" id="footer-note" style="margin-right:auto">Saved to clirevenue.config.json</span>
  <button class="ghost" id="cancel" type="button">Cancel</button>
  <button class="primary" id="save" type="button">Save placement</button>
</footer>

<script>
(function () {
  var DATA = ${payload};
  var TOKEN = ${JSON.stringify(state.token)};

  var ad = document.getElementById('ad');
  var host = document.getElementById('host');
  var els = {
    placement: document.getElementById('placement'),
    width: document.getElementById('width'),
    height: document.getElementById('height'),
    anchor: document.getElementById('anchor'),
    offsetX: document.getElementById('offsetX'),
    offsetY: document.getElementById('offsetY'),
    container: document.getElementById('container'),
    error: document.getElementById('error'),
    adText: document.getElementById('ad-text'),
    hint: document.getElementById('placement-hint'),
    sizeRange: document.getElementById('size-range'),
  };

  DATA.anchors.forEach(function (a) {
    var o = document.createElement('option');
    o.value = a; o.textContent = a;
    els.anchor.appendChild(o);
  });

  var ALL = DATA.integrations.reduce(function (acc, integration) {
    return acc.concat(integration.slots);
  }, []);

  if (!ALL.length) {
    els.error.textContent =
      'No ad slots are configured for this project yet. Run: npx clirevenue add-slot';
    document.getElementById('save').disabled = true;
    els.sizeRange.textContent = 'width ' + DATA.limits.minWidth + '–' + DATA.limits.maxWidth +
      ' · height ' + DATA.limits.minHeight + '–' + DATA.limits.maxHeight;
    return;
  }

  ALL.forEach(function (p) {
    var o = document.createElement('option');
    o.value = p.integrationId + '/' + p.slotId;
    o.textContent = slotLabel(p) + (p.enabled === false ? ' [disabled]' : '');
    els.placement.appendChild(o);
  });

  var current = null;

  function clampSize(w, h) {
    var L = DATA.limits;
    return {
      width: Math.min(L.maxWidth, Math.max(L.minWidth, Math.round(w))),
      height: Math.min(L.maxHeight, Math.max(L.minHeight, Math.round(h))),
    };
  }

  /* Absolute box in host pixels. The page works in pixels because that is
     what a pointer reports; conversion to the SDK's anchor+offset vocabulary
     happens once, on save. */
  var box = { left: 0, top: 0, width: 320, height: 100 };

  function anchorOrigin(anchor, freeX, freeY) {
    if (anchor === 'center') return { x: freeX / 2, y: freeY / 2 };
    var parts = anchor.split('-');
    var x = parts[1] === 'center' ? freeX / 2 : parts[1] === 'right' ? freeX : 0;
    var y = parts[0] === 'center' ? freeY / 2 : parts[0] === 'bottom' ? freeY : 0;
    return { x: x, y: y };
  }

  function clampBox() {
    box.width = Math.min(box.width, host.clientWidth);
    box.height = Math.min(box.height, host.clientHeight);
    box.left = Math.max(0, Math.min(box.left, host.clientWidth - box.width));
    box.top = Math.max(0, Math.min(box.top, host.clientHeight - box.height));
  }

  /* Reduce the pixel box back into { anchor, offsetX, offsetY }.
     Picking the nearest anchor rather than a fixed one keeps a slightly
     off-centre drag as "centre + small offset", so a later responsive
     resize still follows the user's intent instead of snapping to an edge. */
  function boxToLayout(b) {
    var freeX = Math.max(0, host.clientWidth - b.width);
    var freeY = Math.max(0, host.clientHeight - b.height);
    var best = 'center', bestD = Infinity;
    DATA.anchors.forEach(function (a) {
      var o = anchorOrigin(a, freeX, freeY);
      var dx = o.x - b.left, dy = o.y - b.top;
      var d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = a; }
    });
    var o = anchorOrigin(best, freeX, freeY);
    var lim = DATA.limits.maxOffset;
    return {
      anchor: best,
      offsetX: Math.max(-lim, Math.min(lim, Math.round(b.left - o.x))),
      offsetY: Math.max(-lim, Math.min(lim, Math.round(b.top - o.y))),
    };
  }

  function layoutToBox(layout) {
    var size = clampSize(layout.size.width, layout.size.height);
    var freeX = Math.max(0, host.clientWidth - size.width);
    var freeY = Math.max(0, host.clientHeight - size.height);
    var o = anchorOrigin(layout.position.anchor, freeX, freeY);
    return {
      width: size.width,
      height: size.height,
      left: Math.max(0, Math.min(freeX, o.x + layout.position.offsetX)),
      top: Math.max(0, Math.min(freeY, o.y + layout.position.offsetY)),
    };
  }

  function paint() {
    clampBox();
    ad.style.left = box.left + 'px';
    ad.style.top = box.top + 'px';
    ad.style.width = box.width + 'px';
    ad.style.height = box.height + 'px';
    els.adText.textContent = box.width + ' × ' + box.height;
    ad.setAttribute('aria-label',
      'Ad placement box, ' + box.width + ' by ' + box.height + ' pixels, at ' +
      box.left + ', ' + box.top + '. Use arrow keys to move.');
  }

  function syncInputsFromBox() {
    var layout = boxToLayout(box);
    els.width.value = box.width;
    els.height.value = box.height;
    els.anchor.value = layout.anchor;
    els.offsetX.value = layout.offsetX;
    els.offsetY.value = layout.offsetY;
  }

  function slotLabel(slot) {
    var integration = DATA.integrations.filter(function (i) {
      return i.id === slot.integrationId;
    })[0];
    var owner = integration ? integration.label : slot.integrationId;
    return owner + ' / ' + slot.label + ' (' + slot.slotId + ')';
  }

  function select(id) {
    var found = null;
    ALL.forEach(function (p) { if (p.integrationId + '/' + p.slotId === id) found = p; });
    if (!found) return;
    current = found;
    els.placement.value = id;
    els.container.value = found.container || '';
    /* Name the owner as well as the slot: two slots under different
       integrations can look identical in the dropdown, and the user needs to
       know which CLI's placement they are about to move. */
    var integration = DATA.integrations.filter(function (i) {
      return i.id === found.integrationId;
    })[0];
    var owner = integration ? integration.label : found.integrationId;
    els.hint.textContent = found.enabled === false
      ? owner + ' / ' + found.label + ' is disabled. Saving will still store the geometry.'
      : (found.container
        ? 'Saved slot for ' + owner + ', placement key ' + found.placementKey + '.'
        : 'Saved slot for ' + owner + '. No container selector set yet.');
    box = layoutToBox(found.layout);
    paint();
    syncInputsFromBox();
    els.error.textContent = '';
    document.getElementById('subtitle').textContent = 'Editing ' + key;
  }

  function applyInputs() {
    var w = parseFloat(els.width.value), h = parseFloat(els.height.value);
    var ax = parseFloat(els.offsetX.value), ay = parseFloat(els.offsetY.value);
    var size = clampSize(isNaN(w) ? box.width : w, isNaN(h) ? box.height : h);
    var layout = {
      size: size,
      position: {
        anchor: els.anchor.value,
        offsetX: isNaN(ax) ? 0 : ax,
        offsetY: isNaN(ay) ? 0 : ay,
      },
    };
    box = layoutToBox(layout);
    paint();
  }

  els.placement.addEventListener('change', function () { select(els.placement.value); });
  [els.width, els.height, els.offsetX, els.offsetY].forEach(function (el) {
    el.addEventListener('input', applyInputs);
  });
  els.anchor.addEventListener('change', applyInputs);

  /* ---- pointer dragging ---- */
  var drag = null;

  function localPoint(ev) {
    var r = host.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  ad.addEventListener('pointerdown', function (ev) {
    if (ev.target.classList.contains('handle')) {
      drag = { mode: 'resize', dir: ev.target.getAttribute('data-dir'), p: localPoint(ev) };
    } else {
      drag = { mode: 'move', dx: ev.clientX - box.left, dy: ev.clientY - box.top };
    }
    ad.classList.add('dragging');
    ad.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });

  ad.addEventListener('pointermove', function (ev) {
    if (!drag) return;
    if (drag.mode === 'move') {
      box.left = ev.clientX - drag.dx;
      box.top = ev.clientY - drag.dy;
    } else {
      var p = localPoint(ev);
      var right = box.left + box.width, bottom = box.top + box.height;
      if (drag.dir.indexOf('w') > -1) {
        var newLeft = Math.min(p.x, right - DATA.limits.minWidth);
        box.left = newLeft; box.width = right - newLeft;
      }
      if (drag.dir.indexOf('e') > -1) box.width = p.x - box.left;
      if (drag.dir.indexOf('n') > -1) {
        var newTop = Math.min(p.y, bottom - DATA.limits.minHeight);
        box.top = newTop; box.height = bottom - newTop;
      }
      if (drag.dir.indexOf('s') > -1) box.height = p.y - box.top;
      box.width = clampSize(box.width, box.height).width;
      box.height = clampSize(box.width, box.height).height;
    }
    paint();
    syncInputsFromBox();
  });

  ['pointerup', 'pointercancel'].forEach(function (evt) {
    ad.addEventListener(evt, function () {
      if (!drag) return;
      drag = null;
      ad.classList.remove('dragging');
      paint();
      syncInputsFromBox();
    });
  });

  /* ---- keyboard equivalent of dragging ---- */
  ad.addEventListener('keydown', function (ev) {
    var step = ev.shiftKey ? 10 : 1;
    var handled = true;
    switch (ev.key) {
      case 'ArrowLeft': box.left -= step; break;
      case 'ArrowRight': box.left += step; break;
      case 'ArrowUp': box.top -= step; break;
      case 'ArrowDown': box.top += step; break;
      default: handled = false;
    }
    if (!handled) return;
    ev.preventDefault();
    paint();
    syncInputsFromBox();
  });

  document.getElementById('save').addEventListener('click', function () {
    if (!current) return;
    var layout = boxToLayout(box);
    var body = JSON.stringify({
      token: TOKEN,
      integrationId: current.integrationId,
      slotId: current.slotId,
      layout: {
        size: clampSize(box.width, box.height),
        position: layout,
      },
      container: els.container.value.trim() || undefined,
    });
    document.getElementById('save').disabled = true;
    fetch('/api/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body,
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        if (res.ok) { window.close(); }
        else { document.getElementById('save').disabled = false; els.error.textContent = res.body.error || 'Could not save.'; }
      })
      .catch(function (e) {
        document.getElementById('save').disabled = false;
        els.error.textContent = String(e && e.message ? e.message : e);
      });
  });

  document.getElementById('cancel').addEventListener('click', function () {
    fetch('/api/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: TOKEN }),
    }).catch(function () {});
    window.close();
  });

  window.addEventListener('beforeunload', function () {
    navigator.sendBeacon &&
      navigator.sendBeacon('/api/cancel', new Blob([JSON.stringify({ token: TOKEN })], { type: 'application/json' }));
  });

  function fit() {
    host.style.width = DATA.host.width + 'px';
    host.style.height = DATA.host.height + 'px';
    if (current) box = layoutToBox(current.layout), paint(), syncInputsFromBox();
  }
  window.addEventListener('resize', fit);
  fit();
  /* Open the first slot of the requested integration, else the very first
     slot configured. Written as a helper rather than one long expression so
     the intent is readable: an integration is a group of slots, and only the
     slots are selectable. */
  function defaultSelection() {
    var chosen = DATA.integrations.filter(function (i) { return i.id === DATA.selectedId; })[0];
    if (chosen && chosen.slots.length) return chosen.id + '/' + chosen.slots[0].slotId;
    return ALL[0].integrationId + '/' + ALL[0].slotId;
  }
  select(defaultSelection());
  els.sizeRange.textContent = 'width ' + DATA.limits.minWidth + '–' + DATA.limits.maxWidth +
    ' · height ' + DATA.limits.minHeight + '–' + DATA.limits.maxHeight;
})();
</script>
</body>
</html>`;
}

/** The page title shown in the browser tab, kept in one place for tests. */
export const EDITOR_TITLE = 'CLIRevenue — placement editor';

/** Escape helper reused by tests that assert on rendered markup. */
export { escapeHtml };
