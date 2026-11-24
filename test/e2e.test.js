'use strict';
// Runs test/fixture/gmail-mock.html in headless Chrome and checks the assertions
// it writes to #result. Skipped when no Chrome/Chromium binary is found.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  return candidates.find((p) => p && existsSync(p));
}

const chrome = findChrome();
const skip = !chrome && 'no Chrome found';

function runFixture(query) {
  const url = pathToFileURL(path.join(__dirname, 'fixture', 'gmail-mock.html')).href + query;
  const html = execFileSync(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--allow-file-access-from-files',
      '--virtual-time-budget=10000',
      '--window-size=1400,900',
      '--dump-dom',
      url,
    ],
    { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'ignore'] }
  );
  const m = /<pre id="result">([\s\S]*?)<\/pre>/.exec(html);
  assert.ok(m && m[1], 'fixture produced no result');
  const decoded = m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return JSON.parse(decoded);
}

function assertAllPass(results, min) {
  const failed = results.filter((r) => !r.ok);
  assert.ok(results.length >= min, `expected all checks to run, got ${results.length}`);
  assert.deepEqual(failed, [], 'failed checks:\n' + JSON.stringify(failed, null, 2));
}

test('content script works against a mock Gmail DOM', { skip }, () => {
  assertAllPass(runFixture('?mode=test'), 38);
});

test('opening Gmail directly on a custom tab keeps the inbox layout', { skip }, () => {
  assertAllPass(runFixture('?mode=direct#search/in%3Ainbox+unsubscribe'), 4);
});
