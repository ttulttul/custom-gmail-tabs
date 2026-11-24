'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/shared/core.js');

test('searchHash encodes queries the way Gmail does', () => {
  assert.equal(C.searchHash('from:bob is:unread'), '#search/from%3Abob+is%3Aunread');
  assert.equal(C.searchHash('  a   b '), '#search/a+b');
  assert.equal(C.searchHash('subject:"c++ & you"'), '#search/subject%3A%22c%2B%2B+%26+you%22');
});

test('queryFromHash round-trips searchHash', () => {
  for (const q of ['from:bob is:unread', 'subject:"c++ & you"', 'label:a/b', '(x OR y) -z', 'émoji 🎉']) {
    assert.equal(C.queryFromHash(C.searchHash(q)), q);
  }
});

test('queryFromHash handles thread views and non-search hashes', () => {
  assert.equal(C.queryFromHash('#search/is%3Aunread/FMfcgzQXJ'), 'is:unread');
  assert.equal(C.queryFromHash('#advanced-search/from%3Ax'), 'from:x');
  assert.equal(C.queryFromHash('#inbox'), null);
  assert.equal(C.queryFromHash(''), null);
  assert.equal(C.queryFromHash('#search/%E0%A4%A'), null); // malformed escape
  assert.equal(C.isThreadHash('#search/is%3Aunread/FMfcgzQXJ'), true);
  assert.equal(C.isThreadHash('#search/is%3Aunread'), false);
});

test('activeTabForHash matches case- and whitespace-insensitively', () => {
  const tabs = [
    { id: 'a', label: 'A', query: 'from:alice' },
    { id: 'b', label: 'B', query: 'IS:Unread   in:inbox' },
  ];
  assert.equal(C.activeTabForHash(tabs, '#search/is%3Aunread+in%3Ainbox').id, 'b');
  assert.equal(C.activeTabForHash(tabs, '#search/from%3Aalice/abc123').id, 'a');
  assert.equal(C.activeTabForHash(tabs, '#search/from%3Abob'), null);
  assert.equal(C.activeTabForHash(tabs, '#inbox'), null);
});

test('isInboxHash', () => {
  for (const h of ['', '#', '#inbox', '#inbox/', '#inbox/p2']) assert.equal(C.isInboxHash(h), true, h);
  for (const h of ['#inbox/FMfcgz', '#sent', '#search/x', '#label/inbox']) assert.equal(C.isInboxHash(h), false, h);
});

test('sanitizeTabs cleans untrusted input', () => {
  const out = C.sanitizeTabs([
    { id: 'x', label: '  Work  ', query: ' from:boss ', color: '#ABCDEF' },
    { id: 'x', label: 'Dup id', query: 'q', color: 'red' },
    null,
    'nope',
    { label: 'L'.repeat(100), query: 'q', enabled: false },
  ]);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], { id: 'x', label: 'Work', query: 'from:boss', color: '#abcdef', enabled: true });
  assert.notEqual(out[1].id, 'x');
  assert.ok(C.isColor(out[1].color));
  assert.equal(out[2].label.length, C.MAX_LABEL);
  assert.equal(out[2].enabled, false);
  assert.deepEqual(C.sanitizeTabs('garbage'), []);
  assert.equal(C.sanitizeTabs(Array.from({ length: 50 }, (_, i) => ({ label: 'x', query: String(i) }))).length, C.MAX_TABS);
});

test('visibleTabs drops disabled and incomplete tabs', () => {
  const v = C.visibleTabs([
    { label: 'ok', query: 'q' },
    { label: '', query: 'q' },
    { label: 'no query', query: '  ' },
    { label: 'off', query: 'q', enabled: false },
  ]);
  assert.deepEqual(v.map((t) => t.label), ['ok']);
});

test('sanitizeSettings applies defaults', () => {
  assert.deepEqual(C.sanitizeSettings(null), { showStripOnResults: true });
  assert.deepEqual(C.sanitizeSettings({ showStripOnResults: false, junk: 1 }), { showStripOnResults: false });
  assert.deepEqual(C.sanitizeSettings({ showStripOnResults: 'no' }), { showStripOnResults: true });
});
