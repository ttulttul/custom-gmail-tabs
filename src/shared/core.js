/*
 * Shared, DOM-free logic used by the content script, options page, popup and
 * tests. Loaded as a classic script (exposes globalThis.CGT) and as a CommonJS
 * module under Node for unit tests.
 */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'tabs';
  const SETTINGS_KEY = 'settings';
  const MAX_TABS = 12;
  const MAX_LABEL = 40;
  const MAX_QUERY = 500;

  const PALETTE = [
    '#d93025', // red
    '#e8710a', // orange
    '#f9ab00', // amber
    '#188038', // green
    '#12b5cb', // teal
    '#1a73e8', // blue
    '#9334e6', // purple
    '#e52592', // pink
    '#5f6368', // grey
  ];

  const DEFAULT_SETTINGS = Object.freeze({
    // Render a tab strip above results when a custom tab's search is open, so
    // the user can hop back to Primary/Promotions/etc. without losing context.
    showStripOnResults: true,
  });

  const PRESETS = [
    { label: 'Unread', query: 'in:inbox is:unread', color: '#1a73e8' },
    { label: 'Receipts', query: 'in:inbox (receipt OR invoice OR "order confirmation")', color: '#188038' },
    { label: 'Newsletters', query: 'in:inbox unsubscribe -category:promotions', color: '#e8710a' },
    { label: 'Attachments', query: 'in:inbox has:attachment newer_than:30d', color: '#9334e6' },
    { label: 'Starred', query: 'is:starred', color: '#f9ab00' },
  ];

  function normalizeQuery(query) {
    return String(query == null ? '' : query).trim().replace(/\s+/g, ' ').toLowerCase();
  }

  /** Gmail URL fragment that runs `query`, e.g. "#search/from%3Abob+is%3Aunread". */
  function searchHash(query) {
    const q = String(query == null ? '' : query).trim().replace(/\s+/g, ' ');
    return '#search/' + encodeURIComponent(q).replace(/%20/g, '+');
  }

  /**
   * Extract the search query from a Gmail URL fragment. Returns null when the
   * fragment is not a search view. Thread views under a search
   * ("#search/q/FMfcg...") still report the query.
   */
  function queryFromHash(hash) {
    const m = /^#(?:search|advanced-search)\/([^/?]*)/.exec(String(hash || ''));
    if (!m) return null;
    try {
      return decodeURIComponent(m[1].replace(/\+/g, ' '));
    } catch (_) {
      return null;
    }
  }

  /** True when the fragment is a thread opened from a search result list. */
  function isThreadHash(hash) {
    return /^#(?:search|advanced-search)\/[^/]*\/[^/]+/.test(String(hash || ''));
  }

  /** The custom tab whose query is open in `hash`, or null. */
  function activeTabForHash(tabs, hash) {
    const q = queryFromHash(hash);
    if (q == null) return null;
    const nq = normalizeQuery(q);
    return (tabs || []).find((t) => normalizeQuery(t.query) === nq) || null;
  }

  /** True for the inbox list view where Gmail shows its category tabs. */
  function isInboxHash(hash) {
    return /^(#inbox\/?$|#inbox\/p\d+$|#?$)/.test(String(hash || ''));
  }

  function newId() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') {
      return root.crypto.randomUUID();
    }
    return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function isColor(c) {
    return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
  }

  /** Coerce untrusted input (storage, imports) into a clean tab list. */
  function sanitizeTabs(input) {
    if (!Array.isArray(input)) return [];
    const seen = new Set();
    const out = [];
    for (const raw of input) {
      if (!raw || typeof raw !== 'object') continue;
      const label = String(raw.label == null ? '' : raw.label).trim().slice(0, MAX_LABEL);
      const query = String(raw.query == null ? '' : raw.query).trim().slice(0, MAX_QUERY);
      let id = typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 64) : newId();
      if (seen.has(id)) id = newId();
      seen.add(id);
      out.push({
        id,
        label,
        query,
        color: isColor(raw.color) ? raw.color.toLowerCase() : PALETTE[out.length % PALETTE.length],
        enabled: raw.enabled !== false,
      });
      if (out.length >= MAX_TABS) break;
    }
    return out;
  }

  /** Tabs that are complete enough to show in Gmail. */
  function visibleTabs(tabs) {
    return sanitizeTabs(tabs).filter((t) => t.enabled && t.label && t.query);
  }

  function sanitizeSettings(input) {
    const s = Object.assign({}, DEFAULT_SETTINGS);
    if (input && typeof input === 'object') {
      if (typeof input.showStripOnResults === 'boolean') s.showStripOnResults = input.showStripOnResults;
    }
    return s;
  }

  /** Small stable string used to detect when injected DOM is out of date. */
  function signature(tabs, extra) {
    return JSON.stringify([extra || '', (tabs || []).map((t) => [t.id, t.label, t.query, t.color])]);
  }

  const api = {
    STORAGE_KEY,
    SETTINGS_KEY,
    MAX_TABS,
    MAX_LABEL,
    MAX_QUERY,
    PALETTE,
    PRESETS,
    DEFAULT_SETTINGS,
    normalizeQuery,
    searchHash,
    queryFromHash,
    isThreadHash,
    activeTabForHash,
    isInboxHash,
    newId,
    isColor,
    sanitizeTabs,
    visibleTabs,
    sanitizeSettings,
    signature,
  };

  // Browser-only storage helpers.
  if (root.chrome && root.chrome.storage) {
    api.load = async function load() {
      const data = await root.chrome.storage.sync.get({ [STORAGE_KEY]: [], [SETTINGS_KEY]: {} });
      return { tabs: sanitizeTabs(data[STORAGE_KEY]), settings: sanitizeSettings(data[SETTINGS_KEY]) };
    };
    api.saveTabs = function saveTabs(tabs) {
      return root.chrome.storage.sync.set({ [STORAGE_KEY]: sanitizeTabs(tabs) });
    };
    api.saveSettings = function saveSettings(settings) {
      return root.chrome.storage.sync.set({ [SETTINGS_KEY]: sanitizeSettings(settings) });
    };
  }

  root.CGT = Object.assign(root.CGT || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
