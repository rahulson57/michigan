import crypto from 'node:crypto';
import express from 'express';
import { db } from '../db.js';
import { requireAuth, optionalAuth, toUserPublic } from '../auth.js';

const router = express.Router();

/* ------------------------------------------------------------------ *
 * Shared helpers — other routers (profiles, engagement) import these.
 * ------------------------------------------------------------------ */

/** Strip tags and collapse whitespace. */
export function htmlToText(html) {
  if (!html) return '';
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function deriveExcerpt(html, provided) {
  const given = (provided || '').trim();
  if (given) return given;
  const text = htmlToText(html);
  if (text.length <= 200) return text;
  const cut = text.slice(0, 200);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 120 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function deriveReadingTime(html) {
  const words = htmlToText(html).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

export function slugify(title) {
  const base = String(title || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return base || 'untitled';
}

/** Slug guaranteed unique against the articles table. */
export function uniqueSlug(title) {
  const base = slugify(title);
  for (let i = 0; i < 20; i += 1) {
    const candidate = `${base}-${crypto.randomBytes(3).toString('hex')}`;
    const taken = db.prepare('SELECT 1 FROM articles WHERE slug = ?').get(candidate);
    if (!taken) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

/** SELECT columns that produce a row consumable by serializeArticle(). */
export const ARTICLE_SELECT = `
  SELECT a.*,
         u.id AS u_id, u.username AS u_username, u.name AS u_name, u.bio AS u_bio,
         u.avatar_url AS u_avatar_url, u.cover_url AS u_cover_url, u.twitter AS u_twitter,
         u.github AS u_github, u.linkedin AS u_linkedin, u.website AS u_website,
         u.created_at AS u_created_at,
         (SELECT COUNT(*) FROM reactions r WHERE r.article_id = a.id AND r.value = 1)  AS s_up,
         (SELECT COUNT(*) FROM reactions r WHERE r.article_id = a.id AND r.value = -1) AS s_down,
         (SELECT COUNT(*) FROM saves sv WHERE sv.article_id = a.id)                    AS s_saves,
         (SELECT COUNT(*) FROM reshares rs WHERE rs.article_id = a.id)                 AS s_reshares
  FROM articles a
  JOIN users u ON u.id = a.author_id
`;

const tagsStmt = () =>
  db.prepare(
    `SELECT t.name FROM tags t JOIN article_tags at ON at.tag_id = t.id
     WHERE at.article_id = ? ORDER BY t.name`,
  );

function viewerStateFor(articleId, viewerId) {
  if (!viewerId) return { reaction: 0, saved: false, reshared: false };
  const reaction = db
    .prepare('SELECT value FROM reactions WHERE user_id = ? AND article_id = ?')
    .get(viewerId, articleId);
  const saved = db
    .prepare('SELECT 1 FROM saves WHERE user_id = ? AND article_id = ?')
    .get(viewerId, articleId);
  const reshared = db
    .prepare('SELECT 1 FROM reshares WHERE user_id = ? AND article_id = ?')
    .get(viewerId, articleId);
  return {
    reaction: reaction ? Number(reaction.value) : 0,
    saved: Boolean(saved),
    reshared: Boolean(reshared),
  };
}

/**
 * Turn a row from ARTICLE_SELECT into an ArticleSummary (or ArticleFull when
 * `full` is true). FROZEN JSON shape — camelCase everywhere.
 */
export function serializeArticle(row, viewerId = null, { full = false } = {}) {
  if (!row) return null;
  const up = Number(row.s_up || 0);
  const down = Number(row.s_down || 0);

  const summary = {
    id: row.id,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle ?? null,
    excerpt: row.excerpt ?? null,
    coverUrl: row.cover_url ?? null,
    readingTime: Number(row.reading_time || 1),
    status: row.status,
    publishedAt: row.published_at ?? null,
    author: toUserPublic({
      id: row.u_id,
      username: row.u_username,
      name: row.u_name,
      bio: row.u_bio,
      avatar_url: row.u_avatar_url,
      cover_url: row.u_cover_url,
      twitter: row.u_twitter,
      github: row.u_github,
      linkedin: row.u_linkedin,
      website: row.u_website,
      created_at: row.u_created_at,
    }),
    stats: {
      up,
      down,
      saves: Number(row.s_saves || 0),
      reshares: Number(row.s_reshares || 0),
      score: up - down,
    },
    viewer: viewerStateFor(row.id, viewerId),
  };

  if (!full) return summary;

  let contentJson = null;
  try {
    contentJson = row.content_json ? JSON.parse(row.content_json) : null;
  } catch {
    contentJson = null;
  }

  return {
    ...summary,
    contentJson,
    contentHtml: row.content_html ?? '',
    tags: tagsStmt().all(row.id).map((t) => t.name),
  };
}

/** Fetch + serialize one article by id (full shape). */
export function getArticleFullById(id, viewerId = null) {
  const row = db.prepare(`${ARTICLE_SELECT} WHERE a.id = ?`).get(id);
  return serializeArticle(row, viewerId, { full: true });
}

/** Replace an article's tag set. */
export function setArticleTags(articleId, tags) {
  if (!Array.isArray(tags)) return;
  const clean = [
    ...new Set(
      tags
        .map((t) => String(t || '').trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 10),
    ),
  ];
  db.prepare('DELETE FROM article_tags WHERE article_id = ?').run(articleId);
  const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
  const findTag = db.prepare('SELECT id FROM tags WHERE name = ?');
  const link = db.prepare('INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (?, ?)');
  for (const name of clean) {
    insertTag.run(name);
    const tag = findTag.get(name);
    if (tag) link.run(articleId, tag.id);
  }
}

function ownedArticleOr404(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid article id' });
    return null;
  }
  const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(id);
  if (!article) {
    res.status(404).json({ error: 'Article not found' });
    return null;
  }
  if (article.author_id !== req.user.id) {
    res.status(403).json({ error: 'You are not the author of this article' });
    return null;
  }
  return article;
}

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */

// GET /api/articles
router.get('/articles', optionalAuth, (req, res) => {
  const sort = req.query.sort === 'top' ? 'top' : 'recent';
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 100);
  const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);

  const where = ["a.status = 'published'"];
  const params = [];

  if (req.query.author) {
    where.push('u.username = ?');
    params.push(String(req.query.author));
  }
  if (req.query.tag) {
    where.push(
      `a.id IN (SELECT at.article_id FROM article_tags at
                JOIN tags t ON t.id = at.tag_id WHERE t.name = ?)`,
    );
    params.push(String(req.query.tag).trim().toLowerCase());
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const orderSql =
    sort === 'top'
      ? 'ORDER BY (s_up - s_down) DESC, s_saves DESC, a.published_at DESC'
      : 'ORDER BY a.published_at DESC, a.id DESC';

  const rows = db
    .prepare(`${ARTICLE_SELECT} ${whereSql} ${orderSql} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);

  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM articles a JOIN users u ON u.id = a.author_id ${whereSql}`)
    .get(...params).n;

  res.json({
    articles: rows.map((r) => serializeArticle(r, req.user?.id ?? null)),
    total,
  });
});

// GET /api/articles/me/drafts  — must be declared before /articles/:slug
router.get('/articles/me/drafts', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `${ARTICLE_SELECT} WHERE a.author_id = ? AND a.status = 'draft'
       ORDER BY a.updated_at DESC, a.id DESC`,
    )
    .all(req.user.id);
  res.json({ articles: rows.map((r) => serializeArticle(r, req.user.id)) });
});

// GET /api/articles/:slug
router.get('/articles/:slug', optionalAuth, (req, res) => {
  const row = db.prepare(`${ARTICLE_SELECT} WHERE a.slug = ?`).get(req.params.slug);
  if (!row) return res.status(404).json({ error: 'Article not found' });
  if (row.status !== 'published' && row.author_id !== (req.user?.id ?? null)) {
    return res.status(404).json({ error: 'Article not found' });
  }
  res.json(serializeArticle(row, req.user?.id ?? null, { full: true }));
});

// POST /api/articles
router.post('/articles', requireAuth, (req, res) => {
  const { title, subtitle, contentJson, contentHtml, coverUrl, excerpt, tags } = req.body || {};
  const cleanTitle = String(title || '').trim() || 'Untitled';
  const html = typeof contentHtml === 'string' ? contentHtml : '';
  const json = contentJson ? JSON.stringify(contentJson) : null;
  const ts = nowIso();

  const info = db
    .prepare(
      `INSERT INTO articles
       (author_id, slug, title, subtitle, excerpt, cover_url, content_json, content_html,
        reading_time, status, published_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', NULL, ?, ?)`,
    )
    .run(
      req.user.id,
      uniqueSlug(cleanTitle),
      cleanTitle,
      subtitle ? String(subtitle) : null,
      deriveExcerpt(html, excerpt),
      coverUrl ? String(coverUrl) : null,
      json,
      html,
      deriveReadingTime(html),
      ts,
      ts,
    );

  setArticleTags(info.lastInsertRowid, tags || []);
  res.status(201).json(getArticleFullById(info.lastInsertRowid, req.user.id));
});

// PUT /api/articles/:id
router.put('/articles/:id', requireAuth, (req, res) => {
  const article = ownedArticleOr404(req, res);
  if (!article) return undefined;

  const { title, subtitle, contentJson, contentHtml, coverUrl, excerpt, tags } = req.body || {};
  const nextTitle = title !== undefined ? String(title).trim() || 'Untitled' : article.title;
  const nextHtml = contentHtml !== undefined ? String(contentHtml || '') : article.content_html;
  const nextJson =
    contentJson !== undefined ? (contentJson ? JSON.stringify(contentJson) : null) : article.content_json;

  db.prepare(
    `UPDATE articles SET title = ?, subtitle = ?, excerpt = ?, cover_url = ?,
            content_json = ?, content_html = ?, reading_time = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    nextTitle,
    subtitle !== undefined ? (subtitle ? String(subtitle) : null) : article.subtitle,
    excerpt !== undefined && String(excerpt || '').trim()
      ? String(excerpt).trim()
      : deriveExcerpt(nextHtml, null),
    coverUrl !== undefined ? (coverUrl ? String(coverUrl) : null) : article.cover_url,
    nextJson,
    nextHtml,
    deriveReadingTime(nextHtml),
    nowIso(),
    article.id,
  );

  if (tags !== undefined) setArticleTags(article.id, tags || []);
  return res.json(getArticleFullById(article.id, req.user.id));
});

// POST /api/articles/:id/publish
router.post('/articles/:id/publish', requireAuth, (req, res) => {
  const article = ownedArticleOr404(req, res);
  if (!article) return undefined;
  const ts = nowIso();
  db.prepare(
    `UPDATE articles SET status = 'published', published_at = COALESCE(published_at, ?), updated_at = ?
     WHERE id = ?`,
  ).run(ts, ts, article.id);
  return res.json(getArticleFullById(article.id, req.user.id));
});

// POST /api/articles/:id/unpublish
router.post('/articles/:id/unpublish', requireAuth, (req, res) => {
  const article = ownedArticleOr404(req, res);
  if (!article) return undefined;
  db.prepare("UPDATE articles SET status = 'draft', updated_at = ? WHERE id = ?").run(
    nowIso(),
    article.id,
  );
  return res.json(getArticleFullById(article.id, req.user.id));
});

// DELETE /api/articles/:id
router.delete('/articles/:id', requireAuth, (req, res) => {
  const article = ownedArticleOr404(req, res);
  if (!article) return undefined;
  db.prepare('DELETE FROM articles WHERE id = ?').run(article.id);
  return res.status(204).end();
});

export default router;
