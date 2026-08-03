import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db } from './db.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'michigan-dev-secret';
export const JWT_EXPIRES_IN = '30d';

/** Sign a session token for a user row / id. */
export function signToken(user) {
  const id = typeof user === 'object' ? user.id : user;
  return jwt.sign({ sub: String(id) }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: JWT_EXPIRES_IN,
  });
}

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compareSync(plain, hash);
}

/**
 * The public projection of a user. FROZEN shape — every route that returns a
 * user (auth, articles, profiles, engagement) must go through this.
 */
export function toUserPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    name: row.name ?? null,
    bio: row.bio ?? null,
    avatarUrl: row.avatar_url ?? null,
    coverUrl: row.cover_url ?? null,
    twitter: row.twitter ?? null,
    github: row.github ?? null,
    linkedin: row.linkedin ?? null,
    website: row.website ?? null,
    createdAt: row.created_at ?? null,
  };
}

const getUserById = () => db.prepare('SELECT * FROM users WHERE id = ?');

function readToken(req) {
  const header = req.get?.('authorization') || req.headers?.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

function resolveUser(req) {
  const token = readToken(req);
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return null;
  }
  const id = Number(payload.sub);
  if (!Number.isInteger(id)) return null;
  return getUserById().get(id) || null;
}

/** 401s when there is no valid token. Sets `req.user` to the full DB row. */
export function requireAuth(req, res, next) {
  const user = resolveUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  req.user = user;
  next();
}

/** Never fails. Sets `req.user` to the full DB row, or null. */
export function optionalAuth(req, _res, next) {
  req.user = resolveUser(req);
  next();
}

export default { requireAuth, optionalAuth, signToken, toUserPublic, hashPassword, verifyPassword };
