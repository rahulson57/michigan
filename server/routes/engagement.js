/**
 * STUB — owned by the engagement task (reactions, saves/read-later, reshares,
 * leaderboard). Mounted at /api by server/index.js.
 *
 * The engagement agent replaces this body; index.js already mounts the router,
 * so nothing outside this file needs to change.
 *
 * Useful imports for the owner:
 *   import { db } from '../db.js';
 *   import { requireAuth, optionalAuth, toUserPublic } from '../auth.js';
 *   import { ARTICLE_SELECT, serializeArticle, getArticleFullById } from './articles.js';
 *
 * Tables are already in place: reactions(user_id, article_id, value, created_at),
 * saves(user_id, article_id, created_at), reshares(id, user_id, article_id, comment, created_at).
 */
import express from 'express';

const router = express.Router();

// Health probe so the mount point is observable before the real routes land.
router.get('/engagement/health', (_req, res) => {
  res.json({ ok: true, stub: true });
});

export default router;
