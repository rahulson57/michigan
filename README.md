# michigan

A Medium-style blogging platform — write, publish, react, save, and reshare long-form
stories. React + Vite on the front, Express + SQLite on the back, no services to stand up.

---

## Quick start

Requires **Node >= 20**. No Docker, no external database.

```bash
npm install     # installs both workspaces (server + client)
npm run seed    # creates data/michigan.db and fills it with demo content
npm run dev     # boots the API and the app together
```

Then open **http://localhost:5400**.

`npm run setup` does the install and the seed in one step.

### Demo credentials

Every seeded writer uses the password **`password123`**.

| Email                  | Username        | Name           |
| ---------------------- | --------------- | -------------- |
| `maya@michigan.dev`    | `mayaokonkwo`   | Maya Okonkwo   |
| `tobias@michigan.dev`  | `tobiaslind`    | Tobias Lind    |
| `priya@michigan.dev`   | `priyaraman`    | Priya Raman    |
| `desmond@michigan.dev` | `desmondhale`   | Desmond Hale   |
| `lucia@michigan.dev`   | `luciamoreau`   | Lucía Moreau   |
| `kenji@michigan.dev`   | `kenjiwatanabe` | Kenji Watanabe |

Sign in with either the email or the username.

### Ports

| Service         | Port   | Notes                                       |
| --------------- | ------ | ------------------------------------------- |
| Vite dev server | `5400` | `strictPort` — the app you open in a browser |
| Express API     | `5401` | Vite proxies `/api` and `/uploads` here      |

Both are fixed by contract. The API deliberately ignores `process.env.PORT` so an
ambient value cannot move it; override with `MICHIGAN_API_PORT` only if you must.

### Scripts

| Command              | Does                                              |
| -------------------- | ------------------------------------------------- |
| `npm run dev`        | API + Vite together via `concurrently`            |
| `npm run dev:server` | API only (`node server/index.js`)                 |
| `npm run dev:client` | Vite only                                         |
| `npm run seed`       | Wipe and repopulate the database (idempotent)     |
| `npm run build`      | `check:routes`, then the client build into `client/dist` |
| `npm run check:routes` | Static + `matchRoutes` assertions over the real route table in `App.jsx` |
| `npm run smoke:browser` | Headless-Chrome pass over every route, asserting page-specific content (needs `npm run dev` running) |

---

## Layout

```
package.json            npm workspaces root
data/michigan.db        SQLite (gitignored — regenerate with `npm run seed`)
server/
  index.js              Express app, mounts every router, listens on 5401
  db.js                 better-sqlite3 handle; applies schema.sql on import
  schema.sql            the frozen schema
  auth.js               JWT + bcrypt, requireAuth / optionalAuth, toUserPublic
  uploads.js            multer config (exported as `upload`) + POST /api/uploads/image
  seed.js               demo content, generates all media locally as SVG
  routes/
    auth.js             register / login / me
    articles.js         article CRUD + the shared serializers
    profiles.js         profile routes
    engagement.js       reactions, saves, reshares, leaderboard
  uploads/              uploaded + generated media (gitignored)
client/
  vite.config.js        port 5400, proxies /api and /uploads to 5401
  src/
    api.js              fetch wrapper — auth header, error shape, uploadImage()
    auth.jsx            AuthProvider / useAuth / RequireAuth
    App.jsx             routes
    styles/global.css   the design system every page builds from
    components/         Nav, Layout
    editor/             RichContent — every article body renders through this
    pages/              one file per route
```

Seeded media (avatars, profile covers, article covers and figures) is generated as
deterministic SVG at seed time and written to `server/uploads/`. Nothing is fetched from
the network, so the app works fully offline.

---

## Data model

SQLite, WAL mode, foreign keys on. `server/schema.sql` is applied idempotently on every
import of `server/db.js`, so there is no migration step.

| Table          | Columns                                                                                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`        | `id`, `username`, `email`, `password_hash`, `name`, `bio`, `avatar_url`, `cover_url`, `twitter`, `github`, `linkedin`, `website`, `created_at`                                 |
| `articles`     | `id`, `author_id`, `slug`, `title`, `subtitle`, `excerpt`, `cover_url`, `content_json`, `content_html`, `reading_time`, `status`, `published_at`, `created_at`, `updated_at`   |
| `tags`         | `id`, `name`                                                                                                                                                                  |
| `article_tags` | `article_id`, `tag_id`                                                                                                                                                        |
| `reactions`    | `user_id`, `article_id`, `value` (`1` up / `-1` down), `created_at`                                                                                                            |
| `saves`        | `user_id`, `article_id`, `created_at` — the read-later list                                                                                                                   |
| `reshares`     | `id`, `user_id`, `article_id`, `comment`, `created_at`                                                                                                                        |

`articles.status` is `'draft'` or `'published'`. SQL is snake_case; JSON is camelCase.

---

## API contract

Base URL `http://localhost:5401` (or same-origin `/api` through the Vite proxy).
Authenticated requests send `Authorization: Bearer <token>`.
Errors are the HTTP status plus `{ "error": "message" }`.

### Shapes

```jsonc
// UserPublic
{ "id": 1, "username": "mayaokonkwo", "name": "Maya Okonkwo", "bio": "…",
  "avatarUrl": "/uploads/…", "coverUrl": "/uploads/…",
  "twitter": "…", "github": "…", "linkedin": "…", "website": "…",
  "createdAt": "2025-06-28T08:17:00.000Z" }

// ArticleSummary
{ "id": 1, "slug": "the-queue-is-the-product", "title": "…", "subtitle": "…",
  "excerpt": "…", "coverUrl": "/uploads/…", "readingTime": 3,
  "status": "published", "publishedAt": "2026-03-07T10:17:00.000Z",
  "author": UserPublic,
  "stats":  { "up": 4, "down": 0, "saves": 2, "reshares": 1, "score": 4 },
  "viewer": { "reaction": 0, "saved": false, "reshared": false } }

// ArticleFull = ArticleSummary plus:
{ "contentJson": { "type": "doc", "content": [] }, "contentHtml": "<p>…</p>",
  "tags": ["distributed-systems"] }
```

`stats.score` is `up - down`. `viewer` describes the *requesting* user and is all
zero/false when unauthenticated.

### Auth

| Method | Path                 | Auth     | Body / notes                                             | Returns             |
| ------ | -------------------- | -------- | -------------------------------------------------------- | ------------------- |
| `POST` | `/api/auth/register` | —        | `{username, email, password, name}`, password >= 8 chars  | `201 {token, user}` |
| `POST` | `/api/auth/login`    | —        | `{email, password}` — `email` also accepts a username     | `200 {token, user}` |
| `GET`  | `/api/auth/me`       | required | —                                                         | `200 {user}`        |

Tokens are HS256 JWTs valid for 30 days, signed with `JWT_SECRET`
(default `michigan-dev-secret` — set a real one before deploying anywhere).

### Articles

| Method   | Path                          | Auth        | Notes                                                                                                     |
| -------- | ----------------------------- | ----------- | --------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/articles`               | optional    | `?sort=recent\|top&author=<username>&tag=<name>&limit=20&offset=0` → `{articles, total}`. Published only.   |
| `GET`    | `/api/articles/:slug`         | optional    | `ArticleFull`. Drafts are visible only to their author, otherwise `404`.                                    |
| `POST`   | `/api/articles`               | required    | `{title, subtitle, contentJson, contentHtml, coverUrl, tags}` → `201 ArticleFull`, created as a draft with a generated unique slug. |
| `PUT`    | `/api/articles/:id`           | author only | Same body, all fields optional → `ArticleFull`.                                                             |
| `POST`   | `/api/articles/:id/publish`   | author only | Sets `status='published'` and `published_at = COALESCE(published_at, now)` → `ArticleFull`.                  |
| `POST`   | `/api/articles/:id/unpublish` | author only | Back to draft → `ArticleFull`.                                                                              |
| `DELETE` | `/api/articles/:id`           | author only | `204`.                                                                                                      |
| `GET`    | `/api/articles/me/drafts`     | required    | `{articles}` — your drafts, most recently edited first.                                                     |

On every save the server derives `excerpt` (first ~200 characters of plain text from
`contentHtml`, if you did not supply one) and `readingTime` (`ceil(words / 200)`).
Tags are lowercased and de-duplicated, max 10 per article.

### Uploads

| Method | Path                 | Auth     | Notes                                                  |
| ------ | -------------------- | -------- | ------------------------------------------------------ |
| `POST` | `/api/uploads/image` | required | `multipart/form-data`, field name `file` → `201 {url}` |

Max 8MB, images only (`jpeg`, `png`, `gif`, `webp`, `svg`). Files land in
`server/uploads/` under a random name and are served from `/uploads/<name>`.

### Profiles and engagement

Mounted under `/api` by `server/index.js` from `server/routes/profiles.js` and
`server/routes/engagement.js`.

---

## Working on the client

**Use the design system.** `client/src/styles/global.css` defines the tokens and classes
every screen is built from — add new primitives there rather than writing component-local
CSS, so the product keeps one voice.

The pieces you will reach for most:

- Layout — `.container`, `.container-narrow`, `.measure`, `.stack`, `.row`, `.cluster`, `.grid`
- Type — `.display`, `.page-title`, `.section-title`, `.card-title`, `.eyebrow`, `.lede`, `.muted`, `.meta`, `.link`
- Reading — `.prose` (the 680px article column; always reach it via `<RichContent/>`)
- Controls — `.btn` with `.btn-primary` / `.btn-ghost` / `.btn-danger` / `.btn-sm` / `.btn-lg`, and `.icon-btn`
- Forms — `.field`, `.label`, `.input`, `.textarea`, `.select`, `.form-hint`, `.form-error`
- Surfaces and bits — `.card`, `.panel`, `.divider`, `.rule-accent`, `.avatar`, `.tag`, `.badge`, `.empty`, `.alert`, `.skeleton`, `.spinner`

Tokens (`--bg`, `--surface`, `--text`, `--muted`, `--border`, `--accent`, `--radius`,
`--shadow*`, the `--step-*` type scale, the `--space-*` scale) are all on `:root`.

**Talk to the API through `api.js`**, never bare `fetch` — it attaches the token and
normalises errors:

```js
import { api, uploadImage } from './api.js';

const { articles } = await api.get('/api/articles?sort=top');
const created      = await api.post('/api/articles', { title, contentHtml });
const url          = await uploadImage(file);
```

**Read session state through `useAuth()`** and guard private routes with `<RequireAuth>`.
`useAuth()` returns `{user, token, loading, login, register, logout, refresh, updateUser}`.
`loading` is `true` only while the session is being rehydrated from `localStorage` on the
first mount — `<RequireAuth>` waits on it so a signed-in user who hits refresh is not
bounced to `/login`. Do not remove it: without an exposed flag the guard cannot tell
"signed out" from "not hydrated yet".

**Render article bodies through `client/src/editor/RichContent.jsx`** so the editor's
renderer applies everywhere at once.

### Profile URLs carry an `@` — read this before touching the route

Profile links are Medium-style: `/@ada`. **The route is declared `/:handle`, not
`/@:username`** (DEC-146). React Router v6 only turns `:name` into a parameter when the
colon immediately follows a slash (its compiler matches `/\/:([\w-]+)/`), so
`/@:username` compiles to a *literal* string and silently never matches — every profile
link would land on the 404 page with no warning from React, Vite or the browser.

The captured param therefore keeps its `@` — which is why it is named `handle`, not
`username`. `App.jsx` strips it and hands the page the clean value as a **prop**, so the
profile page never has to think about it:

```js
export default function Profile({ username }) {   // "ada" — already stripped
  const { user } = await api.get(`/api/profiles/${username}`);
}
```

Link to a profile with `profilePath()` rather than hand-building the string:

```js
import { profilePath } from '../api.js';
<Link to={profilePath(article.author.username)}>…</Link>   // -> "/@ada"
```

`stripHandle()` is exported from `api.js` too, and `GET /api/profiles/:username` accepts
either form, so a stray `@` degrades gracefully instead of 404-ing.

`npm run check:routes` (also run as the first step of `npm run build`) parses the real
route table out of `App.jsx` and asserts against the real react-router matcher that every
URL — `/@ada` included — resolves to the route it should. It fails loudly on the
`"/@:username"` shape, so this class of bug cannot come back silently.

---

## Notes

- `react-router-dom` is pinned to v6 by the project contract. `npm audit` reports a
  moderate advisory affecting every v6 release; the only fix is a v7 major upgrade, so
  this is a deliberate, tracked exception rather than an oversight.
- Publishing uses `published_at = COALESCE(published_at, CURRENT_TIMESTAMP)` (ratified as
  the contract, DEC-146): unpublishing and republishing an old story keeps its original
  date instead of resurfacing it at the top of the feed.
- `npm run seed` is destructive — it wipes every table and deletes previously generated
  `seed-*` media before repopulating. It is safe to run as often as you like.
