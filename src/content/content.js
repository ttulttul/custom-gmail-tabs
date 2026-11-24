/*
 * Custom Gmail Tabs — content script.
 *
 * Two surfaces:
 *  1. Inbox: custom tabs are appended to Gmail's own category tab bar
 *     (Primary / Promotions / Social / Updates / Forums).
 *  2. Results: when a custom tab's search is open, Gmail hides its tab bar, so
 *     we render our own strip (Gmail categories + custom tabs) above the
 *     results, with the custom tab selected. The same strip is shown on the
 *     inbox when Gmail has no category tabs enabled.
 *
 * Gmail's class names are obfuscated and change often, so everything here is
 * keyed off ARIA roles and URL fragments rather than class names.
 */
(function () {
  'use strict';
  if (window.__cgtLoaded) return;
  window.__cgtLoaded = true;

  const C = globalThis.CGT;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const PENDING_MS = 8000;
  const LOCAL_NATIVE_KEY = 'nativeTabs';

  let tabs = [];
  let settings = C.DEFAULT_SETTINGS;
  let nativeLabels = []; // Last seen Gmail category labels, e.g. ["Primary", "Promotions"].
  let pendingNative = null; // { index, at } — Gmail tab to click once the inbox renders.

  // ---------- DOM helpers ----------

  function isVisible(el) {
    if (!el || !el.isConnected || !el.getClientRects().length) return false;
    return getComputedStyle(el).visibility !== 'hidden';
  }

  function visibleMain() {
    for (const m of document.querySelectorAll('[role="main"]')) {
      if (isVisible(m)) return m;
    }
    return null;
  }

  function nativeTabsIn(list) {
    return Array.from(list.querySelectorAll('[role="tab"]')).filter((t) => !t.closest('[data-cgt]'));
  }

  /** Gmail's visible category tab bar inside the main view, if any. */
  function findNativeTablist() {
    const main = visibleMain();
    if (!main) return null;
    for (const list of main.querySelectorAll('[role="tablist"]')) {
      if (list.closest('[data-cgt]')) continue;
      if (!isVisible(list)) continue;
      if (nativeTabsIn(list).length) return list;
    }
    return null;
  }

  /** The direct child of `list` that contains `node` (Gmail wraps each tab in a <td>). */
  function cellFor(node, list) {
    let el = node;
    while (el && el.parentElement !== list) el = el.parentElement;
    return el || node;
  }

  function nativeLabel(tab) {
    const aria = tab.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim().split(/,|\n/)[0].trim();
    const tip = tab.querySelector('[data-tooltip]');
    if (tip && tip.getAttribute('data-tooltip')) return tip.getAttribute('data-tooltip').trim();
    const walker = document.createTreeWalker(tab, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (n.nodeValue.trim()) return n.nodeValue.trim();
    }
    return '';
  }

  function swallow(el) {
    // Keep Gmail's delegated handlers on the tab bar from reacting to our clicks.
    for (const type of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'click', 'dblclick', 'keydown']) {
      el.addEventListener(type, (e) => e.stopPropagation());
    }
  }

  function tagIcon() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'cgt-ico');
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute(
      'd',
      'M17.6 5.84A1.99 1.99 0 0 0 16 5H5c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h11c.67 0 1.27-.33 1.63-.84L22 12l-4.4-6.16zM16 17H5V7h11l3.55 5L16 17z'
    );
    svg.appendChild(p);
    return svg;
  }

  function inboxIcon() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'cgt-ico');
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute(
      'd',
      'M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H5v-3h3.56A5 5 0 0 0 12 17.5a5 5 0 0 0 3.44-1.5H19v3zm0-5h-4.99a3 3 0 0 1-6 0H5V5h14v9z'
    );
    svg.appendChild(p);
    return svg;
  }

  /** One tab button. `onActivate` runs on click / Enter / Space. */
  function makeTab({ label, title, color, active, icon, onActivate }) {
    const tab = document.createElement('div');
    tab.className = 'cgt-tab' + (active ? ' cgt-active' : '');
    tab.setAttribute('role', 'tab');
    tab.setAttribute('tabindex', '0');
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
    if (title) tab.title = title;
    if (color) tab.style.setProperty('--cgt-color', color);
    tab.appendChild(icon);
    const text = document.createElement('span');
    text.className = 'cgt-label';
    text.textContent = label;
    tab.appendChild(text);
    swallow(tab);
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      onActivate();
    });
    tab.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onActivate();
      }
    });
    return tab;
  }

  function customTab(t, active) {
    return makeTab({
      label: t.label,
      title: t.query,
      color: t.color,
      active,
      icon: tagIcon(),
      onActivate: () => openTab(t),
    });
  }

  // ---------- Navigation ----------

  function openTab(t) {
    const hash = C.searchHash(t.query);
    if (location.hash !== hash) location.hash = hash;
  }

  function openNative(index) {
    pendingNative = { index, at: Date.now() };
    if (location.hash !== '#inbox') location.hash = '#inbox';
    schedule();
  }

  function clickLikeAUser(el) {
    for (const type of ['mousedown', 'mouseup', 'click']) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
  }

  // ---------- Surface 1: Gmail's own tab bar ----------

  function rememberNative(list) {
    const labels = nativeTabsIn(list).map(nativeLabel);
    if (labels.join('\n') === nativeLabels.join('\n')) return;
    nativeLabels = labels;
    try {
      chrome.storage.local.set({ [LOCAL_NATIVE_KEY]: labels });
    } catch (_) {
      /* extension context invalidated (reloaded) — harmless */
    }
  }

  function themeFrom(native, target) {
    const label = native.querySelector('[data-tooltip]') || native;
    const cs = getComputedStyle(label);
    target.style.setProperty('--cgt-fg', cs.color);
    target.style.setProperty('--cgt-font', cs.fontFamily);
    const h = native.getBoundingClientRect().height;
    if (h > 20) target.style.setProperty('--cgt-height', Math.round(h) + 'px');
  }

  function injectIntoTablist(list) {
    rememberNative(list);
    const native = nativeTabsIn(list);
    const lastCell = cellFor(native[native.length - 1], list);
    const existing = Array.from(list.children).filter((c) => c.hasAttribute('data-cgt'));
    const sig = C.signature(tabs, 'tablist');

    const upToDate =
      existing.length === tabs.length &&
      list.getAttribute('data-cgt-sig') === sig &&
      (tabs.length === 0 || lastCell.nextElementSibling === existing[0]);
    if (upToDate) return false;

    existing.forEach((c) => c.remove());
    list.setAttribute('data-cgt-sig', sig);
    if (!tabs.length) {
      (list.closest('table') || list).classList.remove('cgt-fit');
      return existing.length > 0;
    }

    const tag = lastCell.tagName.toLowerCase();
    // Take colours from an unselected tab so ours don't inherit the "selected" blue.
    const themeSource = native.find((n) => n.getAttribute('aria-selected') !== 'true') || native[0];
    const frag = document.createDocumentFragment();
    for (const t of tabs) {
      const cell = document.createElement(tag);
      cell.setAttribute('data-cgt', t.id);
      cell.className = 'cgt-cell';
      if (tag === 'td') cell.setAttribute('role', 'heading');
      themeFrom(themeSource, cell);
      cell.appendChild(customTab(t, false));
      frag.appendChild(cell);
    }
    lastCell.after(frag);
    fitTablist(list);
    return true;
  }

  /**
   * Gmail gives each category cell a fixed width. With extra tabs the bar can
   * outgrow the panel, so in that case switch it to equal-width columns.
   */
  function fitTablist(list) {
    const table = list.closest('table') || list;
    const box = table.parentElement;
    if (!box) return;
    table.classList.remove('cgt-fit');
    if (table.scrollWidth > box.clientWidth + 1) table.classList.add('cgt-fit');
  }

  function refit() {
    const list = findNativeTablist();
    if (list && list.querySelector(':scope > [data-cgt]')) fitTablist(list);
  }

  function cleanTablists() {
    // Only Gmail's own bar; the cloned bar in our strip manages itself.
    const outside = (el) => !el.closest('.cgt-strip');
    const cells = Array.from(document.querySelectorAll('.cgt-cell[data-cgt]')).filter(outside);
    for (const c of cells) c.remove();
    for (const l of document.querySelectorAll('[role="tablist"][data-cgt-sig]')) l.removeAttribute('data-cgt-sig');
    if (cells.length) {
      for (const t of document.querySelectorAll('.cgt-fit')) if (outside(t)) t.classList.remove('cgt-fit');
    }
    return cells.length > 0;
  }

  // ---------- Surface 2: our own strip ----------

  function removeStrip() {
    const strips = document.querySelectorAll('.cgt-strip');
    for (const s of strips) s.remove();
    return strips.length > 0;
  }

  /** The child of `main` holding Gmail's toolbar (checkbox, refresh…), if it lives inside main. */
  function toolbarChild(main) {
    const tb = Array.from(main.querySelectorAll('[gh="mtb"]')).find(isVisible);
    if (!tb) return null;
    let c = tb;
    while (c.parentElement !== main) c = c.parentElement;
    return c;
  }

  /** Put the strip where Gmail's tab bar sits on the inbox: just under the toolbar. */
  function placeStrip(main, strip) {
    const tb = toolbarChild(main);
    if (tb) tb.after(strip);
    else main.prepend(strip);
  }

  function stripInPlace(main, strip) {
    if (!strip || strip.parentElement !== main) return false;
    const tb = toolbarChild(main);
    return tb ? tb.nextElementSibling === strip : main.firstElementChild === strip;
  }

  // ---------- Keep the inbox layout on custom tab results ----------
  //
  // A custom tab is a Gmail search, and Gmail decorates search results with
  // extra chrome (Mail/Conversations/Spaces, filter chips) and puts the query
  // in the search box. To make the custom tab feel like a real inbox tab we
  // hide that chrome and clear the box. Search-only chrome is found by
  // comparison: elements laid out above the results that were not visible on
  // the inbox. No Gmail class names are involved.

  const hiddenChrome = new Set();
  let baseline = new WeakSet(); // Layout elements visible on the inbox.
  let baselineTaken = false;
  let baselineAt = 0;

  function layoutSiblings(main) {
    const out = [];
    for (let a = main; a && a.parentElement && a !== document.body; a = a.parentElement) {
      for (const c of a.parentElement.children) if (c !== a) out.push(c);
    }
    return out;
  }

  function recordBaseline(main) {
    if (!main || Date.now() - baselineAt < 1000) return;
    baselineAt = Date.now();
    for (const c of layoutSiblings(main)) if (!hiddenChrome.has(c) && isVisible(c)) baseline.add(c);
    baselineTaken = true;
  }

  function searchField() {
    return document.querySelector('input[name="q"], [role="search"] input, form[role="search"] input');
  }

  function hideSearchChrome(main) {
    const field = searchField();
    const fieldBottom = field && isVisible(field) ? field.getBoundingClientRect().bottom : null;
    // Without a look at the inbox first, only trust the area below the search box.
    if (!baselineTaken && fieldBottom == null) return false;
    const m = main.getBoundingClientRect();
    const found = [];
    for (const c of layoutSiblings(main)) {
      if (hiddenChrome.has(c) || c.hasAttribute('data-cgt') || /^(SCRIPT|STYLE|LINK)$/.test(c.tagName)) continue;
      if (baselineTaken && baseline.has(c)) continue;
      if (!isVisible(c)) continue;
      const r = c.getBoundingClientRect();
      if (r.height === 0 || r.height > 200) continue; // a row of chrome, not a pane
      if (r.bottom > m.top + 1) continue; // must sit above the results
      if (r.right <= m.left || r.left >= m.right) continue; // and over them, not beside
      if (fieldBottom != null && r.top < fieldBottom) continue; // never the header
      if (field && c.contains(field)) continue;
      if (c.matches('[gh="mtb"]') || c.querySelector('[gh="mtb"], [role="checkbox"]')) continue; // the toolbar stays
      found.push(c);
    }
    for (const c of found) {
      c.classList.add('cgt-hide');
      hiddenChrome.add(c);
    }
    return found.length > 0;
  }

  function showSearchChrome() {
    if (!hiddenChrome.size) return false;
    for (const c of hiddenChrome) c.classList.remove('cgt-hide');
    hiddenChrome.clear();
    return true;
  }

  /** Empty the search box while it just echoes the custom tab's query. */
  function clearSearchBox(active) {
    const want = C.normalizeQuery(active.query);
    for (const el of document.querySelectorAll('input, textarea')) {
      if (el === document.activeElement || el.closest('[data-cgt]')) continue;
      if (el.tagName === 'INPUT' && !/^(text|search)$/i.test(el.type)) continue;
      if (el.value && C.normalizeQuery(el.value) === want) el.value = '';
    }
  }

  // Gmail fills the search box a moment after navigation, without DOM
  // mutations we'd see, so look again a few times after each hash change.
  let retryTimers = [];
  function scheduleSettle(delays = [60, 250, 800, 2000]) {
    retryTimers.forEach(clearTimeout);
    retryTimers = delays.map((ms) => setTimeout(schedule, ms));
  }

  // ---------- Surface 2a: a live copy of Gmail's (hidden) tab bar ----------
  //
  // On search results Gmail hides the inbox view but keeps its tab bar in the
  // DOM, with up-to-date icons, "N new" badges and sender previews. Cloning it
  // gives a bar that looks exactly like the real one; we only clear Gmail's
  // "selected" styling from it and append our tabs.

  const SCRUB_ATTR = /^(id|js[a-z]*|tabindex|aria-(controls|owns|labelledby|describedby))$/i;
  let mirrorBroken = false; // Clone turned out invisible (Gmail CSS changed?) — use the drawn strip.

  /** Gmail's tab bar wherever it is (usually hidden), matched by its remembered labels. */
  function findHiddenNativeTablist() {
    if (!nativeLabels.length) return null;
    const want = nativeLabels.join('\n');
    for (const list of document.querySelectorAll('[role="tablist"]')) {
      if (list.closest('[data-cgt]')) continue;
      if (nativeTabsIn(list).map(nativeLabel).join('\n') === want) return list;
    }
    return null;
  }

  /** [tab, its parent, ..., its cell] — the elements between a tab and the tablist. */
  function chainTo(el, list) {
    const out = [];
    for (let e = el; e && e !== list; e = e.parentElement) out.push(e);
    return out;
  }

  /**
   * Classes that only the selected tab (or its wrappers) carries, by depth.
   * Gmail marks the selected tab with obfuscated classes; diffing against the
   * unselected tabs finds them without hard-coding names.
   */
  function selectionClasses(native, list) {
    const sel = native.find((t) => t.getAttribute('aria-selected') === 'true');
    if (!sel) return [];
    const others = native.filter((t) => t !== sel).map((t) => chainTo(t, list));
    return chainTo(sel, list).map((el, depth) => {
      const seen = new Set();
      for (const chain of others) if (chain[depth]) chain[depth].classList.forEach((c) => seen.add(c));
      return Array.from(el.classList).filter((c) => !seen.has(c));
    });
  }

  function scrub(root) {
    for (const el of [root, ...root.querySelectorAll('*')]) {
      for (const a of Array.from(el.attributes)) if (SCRUB_ATTR.test(a.name)) el.removeAttribute(a.name);
    }
  }

  /** Returns true/false (wrote or not), or null when mirroring isn't possible. */
  function renderMirror(main, activeId) {
    if (mirrorBroken) return null;
    const src = findHiddenNativeTablist();
    if (!src) return null;
    const native = nativeTabsIn(src);
    const selIndex = native.findIndex((t) => t.getAttribute('aria-selected') === 'true');
    const sig = C.signature(tabs, JSON.stringify(['mirror', activeId, selIndex, src.textContent]));
    const current = document.querySelector('.cgt-strip');
    if (current && current.getAttribute('data-cgt-sig') === sig && stripInPlace(main, current)) return false;

    // Include single-child wrappers: Gmail styles badges and sender previews
    // through ancestor classes, so the bare table would lose them.
    let sourceRoot = src.closest('table') || src;
    for (let i = 0; i < 3; i++) {
      const p = sourceRoot.parentElement;
      if (!p || p.children.length !== 1 || p.matches('[role="main"]') || p.contains(main)) break;
      sourceRoot = p;
    }
    const clone = sourceRoot.cloneNode(true);
    for (const n of clone.querySelectorAll('[data-cgt]')) n.remove();
    for (const n of [clone, ...clone.querySelectorAll('.cgt-fit')]) n.classList.remove('cgt-fit');
    scrub(clone);
    const list = clone.matches('[role="tablist"]') ? clone : clone.querySelector('[role="tablist"]');
    const cloneTabs = list ? nativeTabsIn(list) : [];
    if (cloneTabs.length !== native.length) return null;
    list.removeAttribute('data-cgt-sig');

    // Clear Gmail's selected styling: whatever Primary (or the current
    // category) had that the others don't.
    if (selIndex >= 0) {
      const classes = selectionClasses(native, src);
      chainTo(cloneTabs[selIndex], list).forEach((el, depth) => {
        for (const c of classes[depth] || []) el.classList.remove(c);
      });
    }
    cloneTabs.forEach((t, i) => {
      t.setAttribute('aria-selected', 'false');
      t.setAttribute('tabindex', '0');
      swallow(t);
      t.addEventListener('click', (e) => {
        e.preventDefault();
        openNative(i);
      });
      t.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openNative(i);
        }
      });
    });

    removeStrip();
    const strip = document.createElement('div');
    strip.className = 'cgt-strip cgt-mirror';
    strip.setAttribute('data-cgt', 'strip');
    strip.setAttribute('data-cgt-sig', sig);
    strip.appendChild(clone);
    placeStrip(main, strip);

    if (!isVisible(list) || list.getBoundingClientRect().height < 10) {
      strip.remove();
      mirrorBroken = true;
      return null;
    }

    const lastCell = cellFor(cloneTabs[cloneTabs.length - 1], list);
    const tag = lastCell.tagName.toLowerCase();
    const frag = document.createDocumentFragment();
    for (const t of tabs) {
      const cell = document.createElement(tag);
      cell.setAttribute('data-cgt', t.id);
      cell.className = 'cgt-cell';
      if (tag === 'td') cell.setAttribute('role', 'heading');
      themeFrom(cloneTabs[0], cell);
      cell.appendChild(customTab(t, t.id === activeId));
      frag.appendChild(cell);
    }
    lastCell.after(frag);
    fitTablist(list);
    return true;
  }

  // ---------- Surface 2b: a drawn strip (fallback) ----------

  function renderStrip(main, activeId, inboxActive) {
    const labels = nativeLabels.length ? nativeLabels : ['Inbox'];
    const sig = C.signature(tabs, JSON.stringify([labels, activeId, inboxActive]));
    const current = document.querySelector('.cgt-strip');
    if (current && current.getAttribute('data-cgt-sig') === sig && stripInPlace(main, current)) return false;
    removeStrip();

    const strip = document.createElement('div');
    strip.className = 'cgt-strip';
    strip.setAttribute('data-cgt', 'strip');
    strip.setAttribute('data-cgt-sig', sig);
    // Follow Gmail's theme (light, dark, or image themes) via its text colour.
    strip.style.setProperty('--cgt-fg', getComputedStyle(main).color);
    const list = document.createElement('div');
    list.className = 'cgt-strip-list';
    list.setAttribute('role', 'tablist');
    list.setAttribute('aria-label', 'Inbox tabs');

    labels.forEach((label, i) => {
      list.appendChild(
        makeTab({
          label,
          active: inboxActive && i === 0,
          icon: inboxIcon(),
          onActivate: () => openNative(i),
        })
      );
    });
    for (const t of tabs) list.appendChild(customTab(t, t.id === activeId));

    strip.appendChild(list);
    placeStrip(main, strip);
    return true;
  }

  // ---------- Render loop ----------

  /** Bring injected UI in line with the page. Returns true if it changed the DOM. */
  function render() {
    const hash = location.hash;
    const list = findNativeTablist();

    if (list) {
      let wrote = removeStrip();
      wrote = showSearchChrome() || wrote;
      recordBaseline(visibleMain());
      wrote = injectIntoTablist(list) || wrote;
      if (pendingNative) {
        const native = nativeTabsIn(list);
        const target = native[pendingNative.index];
        const fresh = Date.now() - pendingNative.at < PENDING_MS;
        pendingNative = null;
        if (fresh && target && target.getAttribute('aria-selected') !== 'true') clickLikeAUser(target);
      }
      return wrote;
    }

    let wrote = cleanTablists();
    if (pendingNative && Date.now() - pendingNative.at > PENDING_MS) pendingNative = null;

    const main = visibleMain();
    const active = C.activeTabForHash(tabs, hash);
    const onResults = active && !C.isThreadHash(hash);
    // Inbox with no category tabs at all (only if we never saw any, to avoid
    // flashing the strip while Gmail is still rendering its own).
    const bareInbox = C.isInboxHash(hash) && nativeLabels.length <= 1 && !pendingNative;

    if (main && tabs.length && settings.showStripOnResults && (onResults || bareInbox)) {
      if (onResults) {
        wrote = hideSearchChrome(main) || wrote;
        clearSearchBox(active);
      }
      const mirrored = active ? renderMirror(main, active.id) : null;
      if (mirrored === null) wrote = renderStrip(main, active ? active.id : null, !active) || wrote;
      else wrote = mirrored || wrote;
    } else {
      wrote = removeStrip() || wrote;
      wrote = showSearchChrome() || wrote;
    }
    return wrote;
  }

  // Render in a microtask: after Gmail's DOM changes settle but before the
  // browser paints, so our tabs never flicker out when Gmail redraws its bar.
  // If we keep rewriting the DOM (e.g. fighting Gmail over the same node),
  // back off to timers rather than spinning.
  let queued = false;
  let writes = 0;
  let windowStart = 0;
  function schedule() {
    if (queued) return;
    queued = true;
    const run = () => {
      queued = false;
      try {
        if (render()) {
          const now = performance.now();
          if (now - windowStart > 1000) {
            windowStart = now;
            writes = 0;
          }
          writes += 1;
        }
      } catch (err) {
        console.warn('[custom-gmail-tabs]', err);
      }
    };
    if (writes > 30 && performance.now() - windowStart < 1000) setTimeout(run, 250);
    else queueMicrotask(run);
  }

  // ---------- Wiring ----------

  async function reload() {
    try {
      const data = await C.load();
      tabs = C.visibleTabs(data.tabs);
      settings = data.settings;
    } catch (_) {
      return;
    }
    // Force a rebuild so edits show up immediately.
    for (const l of document.querySelectorAll('[data-cgt-sig]')) l.removeAttribute('data-cgt-sig');
    schedule();
  }

  async function init() {
    try {
      const local = await chrome.storage.local.get({ [LOCAL_NATIVE_KEY]: [] });
      if (Array.isArray(local[LOCAL_NATIVE_KEY])) nativeLabels = local[LOCAL_NATIVE_KEY].map(String);
    } catch (_) {
      /* ignore */
    }
    await reload();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && (changes[C.STORAGE_KEY] || changes[C.SETTINGS_KEY])) reload();
    });

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || msg.type !== 'cgt:open') return;
      const t = tabs.find((x) => x.id === msg.id);
      if (t) openTab(t);
      sendResponse({ ok: !!t });
    });

    window.addEventListener('hashchange', () => {
      schedule();
      scheduleSettle();
    });
    let resizeTimer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(refit, 150);
    });
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    schedule();
    // Gmail's first load is slow; keep checking the search box for a while.
    scheduleSettle([60, 250, 800, 2000, 4000, 8000]);
  }

  init();
})();
