/**
 * STUB — owned by the profiles task. Mounted at /api by server/index.js.
 *
 * Only the pieces the foundation needs to boot live here. The profiles agent
 * replaces this body; index.js already mounts the router, so nothing outside
 * this file needs to change.
 *
 * Useful imports for the owner:
 *   import { db } from '../db.js';
 *   import { requireAuth, optionalAuth, toUserPublic } from '../auth.js';
 *   import { upload } from '../uploads.js';                 // avatar/cover multipart
 *   import { ARTICLE_SELECT, serializeArticle } from './articles.js';
 */
import express from 'express';
import { db } from '../db.js';
import { toUserPublic, optionalAuth } from '../auth.js';

const router = express.Router();

// GET /api/profiles/:username -> {user: UserPublic}
router.get('/profiles/:username', optionalAuth, (req, res) => {
  const user = db
    .prepare('SELECT * FROM users WHERE lower(username) = lower(?)')
    .get(String(req.params.username));
  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json({ user: toUserPublic(user) });
});

export default router;
