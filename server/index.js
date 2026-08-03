import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { UPLOADS_DIR } from './db.js';
import authRoutes from './routes/auth.js';
import articleRoutes from './routes/articles.js';
import profileRoutes from './routes/profiles.js';
import engagementRoutes from './routes/engagement.js';
import uploadRoutes from './uploads.js';

// Fixed by contract: the API always listens on 5401 and Vite proxies to it.
// (Deliberately NOT process.env.PORT — ambient PORT vars must not move the API.)
const PORT = Number(process.env.MICHIGAN_API_PORT) || 5401;
const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));
app.use(cors());

// Static media
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '1h', fallthrough: true }));

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'michigan-api' }));

// Mount order matters: auth, articles, profiles, engagement, uploads.
app.use('/api/auth', authRoutes);
app.use('/api', articleRoutes);
app.use('/api', profileRoutes);
app.use('/api', engagementRoutes);
app.use('/api/uploads', uploadRoutes);

// 404 (JSON)
app.use((req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` });
});

// Error handler (JSON)
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 8MB)' : err.message;
    return res.status(400).json({ error: message });
  }
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  return res.status(status).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`API on http://localhost:${PORT}`);
});

export default app;
