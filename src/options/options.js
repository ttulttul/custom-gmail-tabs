(function () {
  'use strict';

  const C = globalThis.CGT;
  const NATIVE = ['Primary', 'Promotions', 'Social', 'Updates', 'Forums'];
  const GMAIL = 'https://mail.google.com/mail/u/0/';

  const $ = (sel) => document.querySelector(sel);
  const list = $('#list');
  const tpl = $('#row-tpl');
  const preview = $('#preview');
  const statusEl = $('#status');

  let tabs = [];
  let settings = Object.assign({}, C.DEFAULT_SETTINGS);
  let saveTimer = 0;
  let statusTimer = 0;
  let dragId = null;

  // ---------- Persistence ----------

  function flash(text, isError) {
    statusEl.textContent = text;
    statusEl.classList.toggle('error', !!isError);
    statusEl.classList.add('show');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => statusEl.classList.remove('show'), isError ? 6000 : 1600);
  }

  function queueSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 350);
  }

  async function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    try {
      await C.saveTabs(tabs);
      flash('Saved');
    } catch (err) {
      flash('Could not save: ' + (err && err.message ? err.message : err), true);
    }
  }

  // ---------- Preview ----------

  const TAG_PATH =
    'M17.6 5.84A1.99 1.99 0 0 0 16 5H5c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h11c.67 0 1.27-.33 1.63-.84L22 12l-4.4-6.16zM16 17H5V7h11l3.55 5L16 17z';

  function icon(d) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
    return svg;
  }

  function renderPreview(litId) {
    preview.textContent = '';
    NATIVE.forEach((name, i) => {
      const el = document.createElement('div');
      el.className = 'pv-tab native' + (i === 0 ? ' first' : '');
      const label = document.createElement('span');
      label.textContent = name;
      el.appendChild(label);
      preview.appendChild(el);
    });
    for (const t of tabs) {
      if (!t.enabled) continue;
      const el = document.createElement('div');
      el.className = 'pv-tab custom' + (t.id === litId ? ' lit' : '');
      el.style.setProperty('--c', t.color);
      el.title = t.query;
      el.appendChild(icon(TAG_PATH));
      const label = document.createElement('span');
      label.className = 'pv-label';
      label.textContent = t.label;
      el.appendChild(label);
      preview.appendChild(el);
    }
  }

  // ---------- Rows ----------

  function rowFor(id) {
    return list.querySelector(`.row[data-id="${CSS.escape(id)}"]`);
  }

  function refreshMeta() {
    const n = tabs.length;
    $('#count').textContent = n ? `${n} / ${C.MAX_TABS}` : '';
    $('#empty').hidden = n > 0;
    const full = n >= C.MAX_TABS;
    $('#add').disabled = full;
    for (const b of document.querySelectorAll('.chip')) {
      b.disabled = full || tabs.some((t) => C.normalizeQuery(t.query) === C.normalizeQuery(b.dataset.query));
    }
    list.querySelectorAll('.row').forEach((row, i) => {
      row.querySelector('.up').disabled = i === 0;
      row.querySelector('.down').disabled = i === n - 1;
    });
  }

  function updateTry(row, t) {
    const a = row.querySelector('.try');
    if (t.query.trim()) {
      a.href = GMAIL + C.searchHash(t.query);
      a.removeAttribute('aria-disabled');
    } else {
      a.removeAttribute('href');
      a.setAttribute('aria-disabled', 'true');
    }
  }

  function buildPalette(row, t) {
    const pal = row.querySelector('.palette');
    pal.textContent = '';
    for (const c of C.PALETTE) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(c === t.color));
      b.setAttribute('aria-label', c);
      b.style.setProperty('--c', c);
      b.addEventListener('click', () => {
        t.color = c;
        row.style.setProperty('--c', c);
        pal.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
        pal.hidden = true;
        row.querySelector('.swatch').setAttribute('aria-expanded', 'false');
        row.querySelector('.swatch').focus();
        renderPreview(t.id);
        queueSave();
      });
      pal.appendChild(b);
    }
  }

  function makeRow(t) {
    const row = tpl.content.firstElementChild.cloneNode(true);
    row.dataset.id = t.id;
    row.style.setProperty('--c', t.color);
    row.classList.toggle('off', !t.enabled);

    const label = row.querySelector('.label');
    const query = row.querySelector('.query');
    const enabled = row.querySelector('.enabled');
    const swatch = row.querySelector('.swatch');
    const pal = row.querySelector('.palette');

    label.value = t.label;
    query.value = t.query;
    enabled.checked = t.enabled;
    updateTry(row, t);
    buildPalette(row, t);

    label.addEventListener('input', () => {
      t.label = label.value;
      label.classList.remove('invalid');
      renderPreview(t.id);
      queueSave();
    });
    query.addEventListener('input', () => {
      t.query = query.value;
      query.closest('.query-wrap').classList.remove('invalid');
      updateTry(row, t);
      refreshMeta();
      queueSave();
    });
    label.addEventListener('blur', () => label.classList.toggle('invalid', !t.label.trim()));
    query.addEventListener('blur', () => query.closest('.query-wrap').classList.toggle('invalid', !t.query.trim()));
    for (const el of [label, query]) el.addEventListener('focus', () => renderPreview(t.id));

    enabled.addEventListener('change', () => {
      t.enabled = enabled.checked;
      row.classList.toggle('off', !t.enabled);
      renderPreview(t.id);
      queueSave();
    });

    swatch.addEventListener('click', () => {
      pal.hidden = !pal.hidden;
      swatch.setAttribute('aria-expanded', String(!pal.hidden));
      if (!pal.hidden) pal.querySelector('[aria-checked="true"]')?.focus();
    });

    row.querySelector('.up').addEventListener('click', () => move(t.id, -1));
    row.querySelector('.down').addEventListener('click', () => move(t.id, 1));
    row.querySelector('.del').addEventListener('click', () => remove(t.id));

    // Drag to reorder: only from the grip so text selection still works.
    const grip = row.querySelector('.grip');
    grip.addEventListener('mousedown', () => (row.draggable = true));
    row.addEventListener('dragstart', (e) => {
      dragId = t.id;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', t.id);
    });
    row.addEventListener('dragend', () => {
      row.draggable = false;
      dragId = null;
      row.classList.remove('dragging');
      list.querySelectorAll('.drop-before, .drop-after').forEach((r) => r.classList.remove('drop-before', 'drop-after'));
    });
    row.addEventListener('dragover', (e) => {
      if (!dragId || dragId === t.id) return;
      e.preventDefault();
      const after = e.offsetY > row.offsetHeight / 2;
      row.classList.toggle('drop-after', after);
      row.classList.toggle('drop-before', !after);
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      const after = row.classList.contains('drop-after');
      row.classList.remove('drop-before', 'drop-after');
      if (!dragId || dragId === t.id) return;
      const from = tabs.findIndex((x) => x.id === dragId);
      const [moved] = tabs.splice(from, 1);
      let to = tabs.findIndex((x) => x.id === t.id);
      if (after) to += 1;
      tabs.splice(to, 0, moved);
      renderAll();
      queueSave();
    });

    return row;
  }

  function renderAll(focusId, focusSel) {
    list.textContent = '';
    for (const t of tabs) list.appendChild(makeRow(t));
    renderPreview(focusId);
    refreshMeta();
    if (focusId) rowFor(focusId)?.querySelector(focusSel || '.label')?.focus();
  }

  // ---------- Mutations ----------

  function add(partial) {
    if (tabs.length >= C.MAX_TABS) return;
    const used = new Set(tabs.map((t) => t.color));
    const color = (partial && partial.color) || C.PALETTE.find((c) => !used.has(c)) || C.PALETTE[0];
    const t = { id: C.newId(), label: '', query: '', enabled: true, ...partial, color };
    tabs.push(t);
    renderAll(t.id, partial && partial.label ? '.query' : '.label');
    queueSave();
  }

  function move(id, delta) {
    const i = tabs.findIndex((t) => t.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= tabs.length) return;
    [tabs[i], tabs[j]] = [tabs[j], tabs[i]];
    renderAll(id, delta < 0 ? '.up' : '.down');
    queueSave();
  }

  function remove(id) {
    const i = tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    const [gone] = tabs.splice(i, 1);
    const next = tabs[Math.min(i, tabs.length - 1)];
    renderAll(next && next.id, '.del');
    if (!next) $('#add').focus();
    saveNow();
    flash(`Deleted “${gone.label || 'Untitled'}”`);
  }

  // ---------- Import / export ----------

  function exportJson() {
    const blob = new Blob([JSON.stringify({ version: 1, tabs: C.sanitizeTabs(tabs), settings }, null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'custom-gmail-tabs.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function importJson(file) {
    try {
      const data = JSON.parse(await file.text());
      const incoming = C.sanitizeTabs(Array.isArray(data) ? data : data.tabs);
      if (!incoming.length) throw new Error('no tabs found in file');
      tabs = incoming;
      if (data && data.settings) {
        settings = C.sanitizeSettings(data.settings);
        $('#strip').checked = settings.showStripOnResults;
        await C.saveSettings(settings);
      }
      renderAll();
      await saveNow();
      flash(`Imported ${incoming.length} tab${incoming.length === 1 ? '' : 's'}`);
    } catch (err) {
      flash('Import failed: ' + (err && err.message ? err.message : err), true);
    }
  }

  // ---------- Init ----------

  async function init() {
    const data = await C.load();
    tabs = data.tabs;
    settings = data.settings;

    for (const p of C.PRESETS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = p.label;
      b.title = p.query;
      b.dataset.query = p.query;
      b.style.setProperty('--c', p.color);
      b.addEventListener('click', () => add({ label: p.label, query: p.query, color: p.color }));
      $('#presets').appendChild(b);
    }

    $('#add').addEventListener('click', () => add());
    $('#strip').checked = settings.showStripOnResults;
    $('#strip').addEventListener('change', async (e) => {
      settings.showStripOnResults = e.target.checked;
      await C.saveSettings(settings);
      flash('Saved');
    });
    $('#export').addEventListener('click', exportJson);
    $('#import').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) importJson(f);
      e.target.value = '';
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.palette:not([hidden])').forEach((p) => {
          p.hidden = true;
          p.closest('.row').querySelector('.swatch').setAttribute('aria-expanded', 'false');
        });
      }
    });
    window.addEventListener('beforeunload', () => {
      if (saveTimer) saveNow();
    });

    renderAll();
  }

  init();
})();
