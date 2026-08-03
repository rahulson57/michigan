-- michigan — FROZEN schema. All tables are created up-front, even ones this
-- task does not read from, so parallel feature work never needs a migration.

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT,
  bio           TEXT,
  avatar_url    TEXT,
  cover_url     TEXT,
  twitter       TEXT,
  github        TEXT,
  linkedin      TEXT,
  website       TEXT,
  created_at    TEXT
);

CREATE TABLE IF NOT EXISTS articles (
  id           INTEGER PRIMARY KEY,
  author_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug         TEXT UNIQUE NOT NULL,
  title        TEXT NOT NULL,
  subtitle     TEXT,
  excerpt      TEXT,
  cover_url    TEXT,
  content_json TEXT,
  content_html TEXT,
  reading_time INTEGER DEFAULT 1,
  status       TEXT NOT NULL DEFAULT 'draft',
  published_at TEXT,
  created_at   TEXT,
  updated_at   TEXT
);

CREATE TABLE IF NOT EXISTS tags (
  id   INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS article_tags (
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (article_id, tag_id)
);

-- value 1 = up, -1 = down
CREATE TABLE IF NOT EXISTS reactions (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  value      INTEGER NOT NULL,
  created_at TEXT,
  PRIMARY KEY (user_id, article_id)
);

-- read-later
CREATE TABLE IF NOT EXISTS saves (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  created_at TEXT,
  PRIMARY KEY (user_id, article_id)
);

CREATE TABLE IF NOT EXISTS reshares (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  comment    TEXT,
  created_at TEXT,
  UNIQUE (user_id, article_id)
);

CREATE INDEX IF NOT EXISTS idx_articles_status_published ON articles(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_author          ON articles(author_id);
CREATE INDEX IF NOT EXISTS idx_article_tags_tag         ON article_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_reactions_article        ON reactions(article_id);
CREATE INDEX IF NOT EXISTS idx_saves_article            ON saves(article_id);
CREATE INDEX IF NOT EXISTS idx_saves_user               ON saves(user_id);
CREATE INDEX IF NOT EXISTS idx_reshares_article         ON reshares(article_id);
CREATE INDEX IF NOT EXISTS idx_reshares_user            ON reshares(user_id);
