import express from 'express';
import { db } from '../db.js';
import {
  requireAuth,
  signToken,
  toUserPublic,
  hashPassword,
  verifyPassword,
} from '../auth.js';

const router = express.Router();

const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/auth/register
router.post('/register', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const name = req.body?.name ? String(req.body.name).trim() : null;

  if (!USERNAME_RE.test(username)) {
    return res
      .status(400)
      .json({ error: 'Username must be 3-30 characters, letters, numbers or underscore' });
  }
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email is required' });
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const clash = db
    .prepare('SELECT username, email FROM users WHERE lower(username) = lower(?) OR email = ?')
    .get(username, email);
  if (clash) {
    return res.status(409).json({
      error:
        clash.email === email ? 'That email is already registered' : 'That username is taken',
    });
  }

  const info = db
    .prepare(
      `INSERT INTO users (username, email, password_hash, name, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(username, email, hashPassword(password), name || username, new Date().toISOString());

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  return res.status(201).json({ token: signToken(user), user: toUserPublic(user) });
});

// POST /api/auth/login — the `email` field also accepts a username
router.post('/login', (req, res) => {
  const identifier = String(req.body?.email || req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!identifier || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = db
    .prepare('SELECT * FROM users WHERE email = lower(?) OR lower(username) = lower(?)')
    .get(identifier, identifier);

  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  return res.json({ token: signToken(user), user: toUserPublic(user) });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: toUserPublic(req.user) });
});

export default router;
