/**
 * Browser smoke test — `npm run smoke:browser` (needs `npm run dev` running).
 *
 * Drives real headless Chrome over CDP against http://localhost:5400 and
 * asserts, for each route, that the page rendered ITS OWN content.
 *
 * Why the assertions look like this: an earlier version of this check reported
 * "all 7 routes render" while the profile route was silently rendering the 404
 * page. Asserting that *something* rendered is worthless — every route renders
 * *something*, because NotFound is something. So every case below names a
 * string that ONLY that page can produce, and every case additionally asserts
 * the 404 page is absent. A route that quietly falls through to the catch-all
 * now fails loudly here.
 */
import { spawn } from 'node:child_process';

const BASE = process.env.SMOKE_BASE || 'http://localhost:5400';
const CDP_PORT = Number(process.env.SMOKE_CDP_PORT || 9755);
const CHROME =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// The 404 page's headline. Its presence anywhere but the 404 case is a failure.
const NOT_FOUND_MARKER = "We couldn't find that page.";

const CASES = [
  { url: '/', expect: ['Things worth the time.'] },
  // The two that regressed: the handle must reach the page, not just "a page".
  { url: '/@mayaokonkwo', expect: ['@mayaokonkwo', 'the profiles task owns this screen'] },
  { url: '/@kenjiwatanabe', expect: ['@kenjiwatanabe', 'the profiles task owns this screen'] },
  { url: '/article/any-slug', expect: ['the article-reading task owns this screen'] },
  { url: '/leaderboard', expect: ['the engagement task owns this screen'] },
  { url: '/login', expect: ['Welcome back.', 'Email or username'] },
  { url: '/register', expect: ['michigan/@'] },
  // Auth-guarded: signed out, these must redirect to /login, not render.
  { url: '/write', expect: ['Welcome back.'], expectPath: '/login' },
  { url: '/read-later', expect: ['Welcome back.'], expectPath: '/login' },
  { url: '/settings/profile', expect: ['Welcome back.'], expectPath: '/login' },
  // /signin is a redirect alias for /login.
  { url: '/signin', expect: ['Welcome back.'], expectPath: '/login' },
  // Real 404s must stay 404s — the '@' guard on /:handle depends on this.
  { url: '/nosuchpage', expect: [NOT_FOUND_MARKER], allowNotFound: true },
  { url: '/mayaokonkwo', expect: [NOT_FOUND_MARKER], allowNotFound: true },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      '--user-data-dir=/tmp/michigan-smoke-profile',
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let ws;
  try {
    let targets = null;
    for (let i = 0; i < 30 && !targets; i += 1) {
      await sleep(300);
      try {
        targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      } catch {
        targets = null;
      }
    }
    const page = targets && targets.find((t) => t.type === 'page');
    if (!page) throw new Error('could not attach to headless Chrome');

    ws = new WebSocket(page.webSocketDebuggerUrl);
    const pending = new Map();
    let nextId = 0;
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    };
    const send = (method, params = {}) =>
      new Promise((resolve) => {
        const id = (nextId += 1);
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
      });

    await send('Page.enable');

    const failures = [];
    for (const testCase of CASES) {
      await send('Page.navigate', { url: BASE + testCase.url });
      await sleep(1200);
      const evaluated = await send('Runtime.evaluate', {
        expression: '({text: document.body.innerText, path: location.pathname})',
        returnByValue: true,
      });
      const { text = '', path = '' } = evaluated?.result?.result?.value || {};

      for (const needle of testCase.expect) {
        if (!text.includes(needle)) {
          failures.push(`${testCase.url} — expected to contain ${JSON.stringify(needle)}`);
        }
      }
      if (!testCase.allowNotFound && text.includes(NOT_FOUND_MARKER)) {
        failures.push(`${testCase.url} — rendered the 404 page (route did not match)`);
      }
      const expectedPath = testCase.expectPath || testCase.url;
      if (path !== expectedPath) {
        failures.push(`${testCase.url} — ended at ${path}, expected ${expectedPath}`);
      }
      console.log(`  ${failures.length ? '·' : '✓'} ${testCase.url} -> ${path}`);
    }

    if (failures.length > 0) {
      console.error(`\nsmoke:browser — ${failures.length} failure(s):`);
      for (const failure of failures) console.error(`  • ${failure}`);
      process.exitCode = 1;
      return;
    }
    console.log(`\nsmoke:browser — OK (${CASES.length} routes, page-specific content asserted)`);
  } finally {
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
    chrome.kill();
  }
}

await main();
