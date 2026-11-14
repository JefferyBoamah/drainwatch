'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'drainwatch.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// All times are integer milliseconds since the epoch.
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('reporter','crew','admin')),
  rain_landmark_id INTEGER REFERENCES landmarks(id),
  last_rain_alert_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS otps (
  phone TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS landmarks (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS drains (
  id INTEGER PRIMARY KEY,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  flood_risk REAL NOT NULL DEFAULT 0.5,
  exposure REAL NOT NULL DEFAULT 0.5,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE,
  drain_id INTEGER NOT NULL REFERENCES drains(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  condition TEXT NOT NULL CHECK (condition IN ('clear','partial','full')),
  photo TEXT,
  note TEXT NOT NULL DEFAULT '',
  needs_review INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  client_id TEXT UNIQUE,
  drain_id INTEGER NOT NULL REFERENCES drains(id),
  crew_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('assigned','done','verified','disputed')),
  after_photo TEXT,
  disputed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE TABLE IF NOT EXISTS overrides (
  id INTEGER PRIMARY KEY,
  drain_id INTEGER NOT NULL REFERENCES drains(id),
  rank INTEGER NOT NULL,
  reason TEXT NOT NULL,
  admin_id INTEGER NOT NULL REFERENCES users(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  kind TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS confirmations (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  still_blocked INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_drains_lat ON drains(lat);
CREATE INDEX IF NOT EXISTS idx_reports_drain ON reports(drain_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reports_user ON reports(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_drain ON tasks(drain_id);
CREATE INDEX IF NOT EXISTS idx_tasks_crew ON tasks(crew_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_overrides_drain ON overrides(drain_id);
`);

const settingGet = db.prepare('SELECT value FROM settings WHERE key = ?');
const settingPut = db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

function getSetting(key, fallback) {
  const row = settingGet.get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  settingPut.run(key, String(value));
}

// Accepts 0241234567, 233241234567 or +233241234567. Returns +233... or null.
function normalizePhone(raw) {
  if (typeof raw !== 'string') return null;
  let p = raw.replace(/[\s\-()]/g, '');
  if (/^0\d{9}$/.test(p)) p = '+233' + p.slice(1);
  else if (/^233\d{9}$/.test(p)) p = '+' + p;
  return /^\+233[2-5]\d{8}$/.test(p) ? p : null;
}

module.exports = { db, UPLOAD_DIR, getSetting, setSetting, normalizePhone };
