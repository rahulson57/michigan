/**
 * Profiles — public writer pages, the profile editor, and avatar/cover uploads.
 * Mounted at /api by server/index.js (which this task does not touch).
 *
 * Endpoints
 *   GET  /api/users/:username           -> {user: UserPublic, stats}
 *   GET  /api/users/:username/articles  -> {articles: [ArticleSummary]}
 *   GET  /api/users/:username/reshares  -> {reshares: [{id, comment, createdAt, article}]}
 *   PUT  /api/users/me                  -> {user: UserPublic}      (auth)
 *   POST /api/users/me/avatar           -> {user: UserPublic}      (auth, multipart `file`)
 *   POST /api/users/me/cover            -> {user: UserPublic}      (auth, multipart `file`)
 *
 * Every read route is also served under `/api/profiles/...` because that is the
 * path the README documents and the T1 stub shipped; both prefixes hit the same
 * handler so no caller has to move.
 *
 * The ArticleSummary shape is NOT re-implemented here — rows come from
 * `ARTICLE_SELECT` and go through `serializeArticle()` from ./articles.js, so a
 * summary from this router is byte-identical to one from the articles router.
 */
import express from 'express';
import { db } from '../db.js';
import { requireAuth, optionalAuth, toUserPublic } from '../auth.js';
import { upload, publicUrl } from '../uploads.js';
import { ARTICLE_SELECT, serializeArticle } from './articles.js';

const router = express.Router();

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/**
 * Client profile URLs are `/@ada`, and React Router hands the page the param
 * with its leading "@" still attached (see client/src/App.jsx). Tolerate it
 * here so `/api/users/ada` and `/api/users/@ada` both resolve — a stray "@"
 * degrades gracefully instead of 404-ing.
 */
export const normalizeUsername = (value) => String(value ?? '').replace(/^@+/, '');

/** Both prefixes for a profile path: /api/users/... and /api/profiles/... */
const bothPrefixes = (suffix) => [`/users${suffix}`, `/profiles${suffix}`];

const findUserByUsername = (value) =>
  db
    .prepare('SELECT * FROM users WHERE lower(username) = lower(?)')
    .get(normalizeUsername(value)) || null;

/** Resolve the :username param or answer 404. Returns the row, or null. */
function userOr404(req, res) {
  const user = findUserByUsername(req.params.username);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return null;
  }
  return user;
}

const MAX_BIO = 500;
const MAX_NAME = 80;
const MAX_WEBSITE = 300;
/** Conservative handle charset — covers x/github/linkedin without surprises. */
const HANDLE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

/**
 * "@ada" -> "ada", "https://github.com/ada" -> "ada", "" -> null.
 * People paste whole profile URLs; accepting them beats storing a broken handle.
 */
function cleanHandle(raw, field) {
  if (raw === null || raw === undefined) return null;
  let value = String(raw).trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) {
    try {
      const segments = new URL(value).pathname.split('/').filter(Boolean);
      value = segments.length ? segments[segments.length - 1] : '';
    } catch {
      throw new ValidationError(`${field} is not a valid handle`);
    }
  }
  value = value.replace(/^@+/, '').replace(/\/+$/, '');
  if (!value) return null;
  if (!HANDLE_RE.test(value)) {
    throw new ValidationError(`${field} must be a handle like "ada", not "${String(raw).trim()}"`);
  }
  return value;
}

/** "" -> null; anything else must parse as an absolute http(s) URL. */
function cleanWebsite(raw) {
  if (raw === null || raw === undefined) return null;
  const value = String(raw).trim();
  if (!value) return null;
  if (value.length > MAX_WEBSITE) {
    throw new ValidationError(`Website must be ${MAX_WEBSITE} characters or fewer`);
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new ValidationError('Website must be a full URL starting with http:// or https://');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ValidationError('Website must be a full URL starting with http:// or https://');
  }
  if (!parsed.hostname || !parsed.hostname.includes('.')) {
    throw new ValidationError('Website must be a full URL starting with http:// or https://');
  }
  // Store what the writer typed, not URL's normalised form — `new URL()` would
  // turn "https://example.com" into "https://example.com/", and the profile
  // should show the link back exactly as it was entered.
  return value;
}

function cleanName(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  if (value.length > MAX_NAME) {
    throw new ValidationError(`Name must be ${MAX_NAME} characters or fewer`);
  }
  return value;
}

function cleanBio(raw) {
  const value = String(raw ?? '').replace(/\r\n/g, '\n').trim();
  if (!value) return null;
  if (value.length > MAX_BIO) {
    throw new ValidationError(`Bio must be ${MAX_BIO} characters or fewer`);
  }
  return value;
}

/** Reception + output counters shown under the profile header. */
function statsFor(user, viewerId) {
  const one = (sql, ...params) => db.prepare(sql).get(...params);

  const articles = one(
    "SELECT COUNT(*) AS n FROM articles WHERE author_id = ? AND status = 'published'",
    user.id,
  ).n;

  const reactions = one(
    `SELECT
       COALESCE(SUM(CASE WHEN r.value = 1 THEN 1 ELSE 0 END), 0)  AS up,
       COALESCE(SUM(CASE WHEN r.value = -1 THEN 1 ELSE 0 END), 0) AS down
     FROM reactions r
     JOIN articles a ON a.id = r.article_id
     WHERE a.author_id = ? AND a.status = 'published'`,
    user.id,
  );

  // Reshares OF this writer's work (reception) vs reshares BY them (the tab).
  const totalReshares = one(
    `SELECT COUNT(*) AS n FROM reshares rs
     JOIN articles a ON a.id = rs.article_id
     WHERE a.author_id = ? AND a.status = 'published'`,
    user.id,
  ).n;

  const reshares = one('SELECT COUNT(*) AS n FROM reshares WHERE user_id = ?', user.id).n;

  const stats = {
    articles,
    totalUp: Number(reactions.up || 0),
    totalDown: Number(reactions.down || 0),
    totalReshares,
    reshares,
  };

  // Draft count is the owner's business only.
  if (viewerId && viewerId === user.id) {
    stats.drafts = one(
      "SELECT COUNT(*) AS n FROM articles WHERE author_id = ? AND status = 'draft'",
      user.id,
    ).n;
  }

  return stats;
}

/** Persist one column on the signed-in user and return their fresh public row. */
function updateOwnColumn(userId, column, value) {
  db.prepare(`UPDATE users SET ${column} = ? WHERE id = ?`).run(value, userId);
  return toUserPublic(db.prepare('SELECT * FROM users WHERE id = ?').get(userId));
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

// GET /api/users/:username -> {user: UserPublic, stats}
router.get(bothPrefixes('/:username'), optionalAuth, (req, res) => {
  const user = userOr404(req, res);
  if (!user) return undefined;
  // toUserPublic() is the frozen projection: no password_hash, no email.
  return res.json({ user: toUserPublic(user), stats: statsFor(user, req.user?.id ?? null) });
});

// GET /api/users/:username/articles -> {articles: [ArticleSummary]}
router.get(bothPrefixes('/:username/articles'), optionalAuth, (req, res) => {
  const user = userOr404(req, res);
  if (!user) return undefined;

  const viewerId = req.user?.id ?? null;
  const isOwner = viewerId === user.id;
  // Drafts are only ever visible to their author, and only when asked for.
  const wantsDrafts = isOwner && String(req.query.status || '') === 'draft';
  const includeDrafts = isOwner && ['all', 'draft'].includes(String(req.query.status || ''));

  const statusSql = wantsDrafts
    ? "AND a.status = 'draft'"
    : includeDrafts
      ? ''
      : "AND a.status = 'published'";

  const rows = db
    .prepare(
      `${ARTICLE_SELECT}
       WHERE a.author_id = ? ${statusSql}
       ORDER BY COALESCE(a.published_at, a.updated_at, a.created_at) DESC, a.id DESC`,
    )
    .all(user.id);

  return res.json({ articles: rows.map((row) => serializeArticle(row, viewerId)) });
});

// GET /api/users/:username/reshares -> {reshares: [{id, comment, createdAt, article}]}
// Read-only: the write endpoint for resharing belongs to the engagement router.
router.get(bothPrefixes('/:username/reshares'), optionalAuth, (req, res) => {
  const user = userOr404(req, res);
  if (!user) return undefined;

  const viewerId = req.user?.id ?? null;
  const rows = db
    .prepare(
      `SELECT id, article_id, comment, created_at FROM reshares
       WHERE user_id = ? ORDER BY created_at DESC, id DESC`,
    )
    .all(user.id);

  const articleStmt = db.prepare(`${ARTICLE_SELECT} WHERE a.id = ?`);
  const reshares = rows
    .map((row) => {
      const article = articleStmt.get(row.article_id);
      if (!article) return null;
      // A reshared story that has since been unpublished stays hidden from
      // everyone but its author, exactly as it is on the article route.
      if (article.status !== 'published' && article.author_id !== viewerId) return null;
      return {
        id: row.id,
        comment: row.comment ?? null,
        createdAt: row.created_at ?? null,
        article: serializeArticle(article, viewerId),
      };
    })
    .filter(Boolean);

  return res.json({ reshares });
});

/* ------------------------------------------------------------------ *
 * Writes (the signed-in user only — there is no way to edit anyone else)
 * ------------------------------------------------------------------ */

// PUT /api/users/me -> {user: UserPublic}
router.put(bothPrefixes('/me'), requireAuth, (req, res) => {
  const body = req.body || {};
  const current = req.user;

  // Every field is optional; only the keys actually sent are written, so the
  // editor can save one field without blanking the rest.
  const patch = {};
  try {
    if ('name' in body) patch.name = cleanName(body.name);
    if ('bio' in body) patch.bio = cleanBio(body.bio);
    if ('twitter' in body) patch.twitter = cleanHandle(body.twitter, 'X (Twitter) handle');
    if ('github' in body) patch.github = cleanHandle(body.github, 'GitHub handle');
    if ('linkedin' in body) patch.linkedin = cleanHandle(body.linkedin, 'LinkedIn handle');
    if ('website' in body) patch.website = cleanWebsite(body.website);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }

  const columns = Object.keys(patch);
  if (columns.length) {
    db.prepare(`UPDATE users SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(
      ...columns.map((c) => patch[c]),
      current.id,
    );
  }

  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(current.id);
  return res.json({ user: toUserPublic(fresh) });
});

/** Shared handler for the two image endpoints. */
const saveImage = (column) => (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded (field name must be "file")' });
  }
  const user = updateOwnColumn(req.user.id, column, publicUrl(req.file.filename));
  return res.json({ user });
};

// POST /api/users/me/avatar  (multipart, field name `file`)
router.post(bothPrefixes('/me/avatar'), requireAuth, upload.single('file'), saveImage('avatar_url'));

// POST /api/users/me/cover   (multipart, field name `file`)
router.post(bothPrefixes('/me/cover'), requireAuth, upload.single('file'), saveImage('cover_url'));

export default router;
