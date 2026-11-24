(function () {
  'use strict';
  const C = globalThis.CGT;
  const GMAIL = 'https://mail.google.com/mail/u/0/';

  async function open(t) {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (active && active.url && active.url.startsWith('https://mail.google.com/')) {
      try {
        const res = await chrome.tabs.sendMessage(active.id, { type: 'cgt:open', id: t.id });
        if (res && res.ok) return window.close();
      } catch (_) {
        /* content script not ready; fall through and navigate directly */
      }
      const base = active.url.split('#')[0];
      await chrome.tabs.update(active.id, { url: base + C.searchHash(t.query) });
    } else {
      await chrome.tabs.create({ url: GMAIL + C.searchHash(t.query) });
    }
    window.close();
  }

  async function init() {
    const { tabs } = await C.load();
    const shown = C.visibleTabs(tabs);
    const list = document.getElementById('list');
    for (const t of shown) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.style.setProperty('--c', t.color);
      const dot = document.createElement('span');
      dot.className = 'dot';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = t.label;
      const q = document.createElement('span');
      q.className = 'q';
      q.textContent = t.query;
      b.append(dot, name, q);
      b.addEventListener('click', () => open(t));
      li.appendChild(b);
      list.appendChild(li);
    }
    document.getElementById('empty').hidden = shown.length > 0;
    const manage = () => {
      chrome.runtime.openOptionsPage();
      window.close();
    };
    document.getElementById('manage').addEventListener('click', manage);
    document.getElementById('setup').addEventListener('click', manage);
  }

  init();
})();
