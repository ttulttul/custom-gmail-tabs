// Regenerates docs/screenshots/*.png with headless Chrome, using the mock Gmail
// fixture and the real options/popup pages backed by a fake chrome.* shim.
// Run: npm run screenshots   (set CHROME_PATH if Chrome isn't in a usual place)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'docs', 'screenshots');
const demo = join(root, 'test', 'fixture', '.demo');
mkdirSync(out, { recursive: true });
mkdirSync(demo, { recursive: true });

const chrome = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => p && existsSync(p));
if (!chrome) throw new Error('Chrome not found; set CHROME_PATH');

const SEED = `<script src="../chrome-shim.js"></script><script>
__shim.areas.sync.tabs = [
  { id: 'r', label: 'Receipts', query: 'in:inbox (receipt OR invoice OR "order confirmation")', color: '#188038' },
  { id: 'n', label: 'Newsletters', query: 'in:inbox unsubscribe -category:promotions', color: '#e8710a' },
  { id: 'b', label: 'From the boss', query: 'from:dana@example.com is:unread', color: '#9334e6', enabled: false },
];
</script>`;

// Copy a page into .demo/, pointing its relative URLs back at src/.
function demoPage(name) {
  let html = readFileSync(join(root, 'src', name, `${name}.html`), 'utf8');
  html = html
    .replace(`href="${name}.css"`, `href="../../../src/${name}/${name}.css"`)
    .replace(`src="${name}.js"`, `src="../../../src/${name}/${name}.js"`)
    .replace('<script src="../shared/core.js"></script>', `${SEED}<script src="../../../src/shared/core.js"></script>`);
  const file = join(demo, `${name}.html`);
  writeFileSync(file, html);
  return pathToFileURL(file).href;
}

function shot(url, file, w, h) {
  execFileSync(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--hide-scrollbars',
      '--allow-file-access-from-files',
      '--virtual-time-budget=3000',
      `--window-size=${w},${h}`,
      `--screenshot=${join(out, file)}`,
      url,
    ],
    { stdio: 'ignore', timeout: 60000 }
  );
  console.log('wrote', join('docs/screenshots', file));
}

const mock = pathToFileURL(join(root, 'test', 'fixture', 'gmail-mock.html')).href;
shot(mock + '?mode=inbox', 'gmail-inbox.png', 1440, 420);
shot(mock + '?mode=results', 'gmail-results.png', 1440, 420);
shot(demoPage('options'), 'options.png', 1000, 1500);
shot(demoPage('popup'), 'popup.png', 300, 190);
