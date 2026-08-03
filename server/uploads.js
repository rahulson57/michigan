import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { requireAuth } from './auth.js';
import { UPLOADS_DIR } from './db.js';

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]);

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
};

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename(_req, file, cb) {
    const ext = (path.extname(file.originalname || '') || EXT_BY_MIME[file.mimetype] || '.bin')
      .toLowerCase();
    cb(null, `${crypto.randomBytes(12).toString('hex')}${ext}`);
  },
});

/**
 * Shared, configured multer instance. Other routers (profiles: avatar/cover)
 * import this — do not re-configure multer elsewhere.
 */
export const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter(_req, file, cb) {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      const err = new Error('Only image uploads are allowed (jpeg, png, gif, webp, svg)');
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  },
});

/** Public URL for a stored file. */
export function publicUrl(filename) {
  return `/uploads/${filename}`;
}

const router = express.Router();

// POST /api/uploads/image  (multipart, field name `file`)
router.post('/image', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name must be "file")' });
  res.status(201).json({ url: publicUrl(req.file.filename) });
});

export default router;
