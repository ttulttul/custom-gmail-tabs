// Minimal in-memory stand-in for the chrome.* APIs the extension uses.
(function () {
  const listeners = { changed: [], message: [] };
  const areas = { sync: {}, local: {} };
  function area(name) {
    return {
      async get(defaults) {
        const out = Object.assign({}, defaults);
        for (const k of Object.keys(out)) if (k in areas[name]) out[k] = structuredClone(areas[name][k]);
        return out;
      },
      async set(obj) {
        const changes = {};
        for (const [k, v] of Object.entries(obj)) {
          changes[k] = { oldValue: areas[name][k], newValue: structuredClone(v) };
          areas[name][k] = structuredClone(v);
        }
        setTimeout(() => listeners.changed.forEach((fn) => fn(changes, name)), 0);
      },
    };
  }
  window.chrome = {
    storage: {
      sync: area('sync'),
      local: area('local'),
      onChanged: { addListener: (fn) => listeners.changed.push(fn) },
    },
    runtime: {
      onMessage: { addListener: (fn) => listeners.message.push(fn) },
      openOptionsPage() {},
    },
  };
  window.__shim = { areas, listeners };
})();
