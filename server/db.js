import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repo root (one level above server/). */
export const ROOT_DIR = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const DB_PATH = process.env.MICHIGAN_DB || path.join(DATA_DIR, 'michigan.db');
export const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Ensure the directories we depend on exist before opening anything.
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Idempotent — schema.sql is all CREATE ... IF NOT EXISTS.
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

export default db;
