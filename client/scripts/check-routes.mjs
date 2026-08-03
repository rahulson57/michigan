/**
 * Route regression guard — run with `npm run check:routes`.
 *
 * Why this exists: React Router v6 only captures a dynamic segment when the
 * colon immediately follows a slash (its compiler matches /\/:([\w-]+)/).
 * A path like "/@:username" therefore compiles to a LITERAL string, silently
 * never matches, and the page it points at becomes unreachable — with no
 * warning from React, Vite or the browser. That exact bug shipped once; this
 * script makes it impossible to ship again.
 *
 * It reads the real route table out of client/src/App.jsx (no duplicated list
 * that could drift) and asserts against the real react-router matcher.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { matchRoutes } from 'react-router-dom';

const here = dirname(fileURLToPath(import.meta.url));
const appPath = resolve(here, '../src/App.jsx');
const source = readFileSync(appPath, 'utf8');

// Every path="..." on a <Route> in App.jsx, in declaration order.
const paths = [...source.matchAll(/<Route\b[^>]*?\bpath="([^"]+)"/g)].map((m) => m[1]);
if (paths.length === 0) {
  console.error('check:routes — found no <Route path="..."> in client/src/App.jsx');
  process.exit(1);
}

const routes = paths.map((path) => ({ path, id: path }));
const failures = [];

// 1. Structural rule: a ":" may only appear directly after a "/".
for (const path of paths) {
  for (let i = 0; i < path.length; i += 1) {
    if (path[i] === ':' && path[i - 1] !== '/') {
      failures.push(
        `path="${path}" — ":" must directly follow "/" to be a dynamic segment. ` +
          'React Router v6 treats this as a literal string, so the route never matches.',
      );
      break;
    }
  }
}

// 2. Behavioural rule: these URLs must resolve to these route paths.
const expectations = [
  ['/', '/'],
  ['/@ada', '/:handle'],
  ['/@maya-okonkwo', '/:handle'],
  ['/article/some-slug', '/article/:slug'],
  ['/write', '/write'],
  ['/write/42', '/write/:id'],
  ['/settings/profile', '/settings/profile'],
  ['/read-later', '/read-later'],
  ['/leaderboard', '/leaderboard'],
  ['/login', '/login'],
  ['/register', '/register'],
  ['/signin', '/signin'],
  ['/definitely/not/a/page', '*'],
];

for (const [url, expected] of expectations) {
  const matched = matchRoutes(routes, url);
  const actual = matched ? matched[matched.length - 1].route.path : '(no match)';
  if (actual !== expected) {
    failures.push(`${url} matched "${actual}" — expected "${expected}"`);
  }
}

// 3. The profile param must actually be captured.
const profile = matchRoutes(routes, '/@ada');
const captured = profile?.[profile.length - 1]?.params?.handle;
if (captured !== '@ada') {
  failures.push(`/@ada did not capture a handle param (got ${JSON.stringify(captured)})`);
}

if (failures.length > 0) {
  console.error(`check:routes — ${failures.length} failure(s) in client/src/App.jsx:`);
  for (const failure of failures) console.error(`  • ${failure}`);
  process.exit(1);
}

console.log(`check:routes — OK (${paths.length} routes, ${expectations.length} URLs verified)`);
