const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'youtube_ai_studio.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS oauth_tokens (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    access_token TEXT,
    refresh_token TEXT,
    expiry_date INTEGER,
    scope TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS channel_profile (
    channel_id TEXT PRIMARY KEY,
    title TEXT,
    custom_url TEXT,
    thumbnail_url TEXT,
    subscriber_count INTEGER DEFAULT 0,
    view_count INTEGER DEFAULT 0,
    video_count INTEGER DEFAULT 0,
    total_likes INTEGER DEFAULT 0,
    total_comments INTEGER DEFAULT 0,
    estimated_revenue REAL,
    valid_watch_hours REAL DEFAULT 0,
    valid_shorts_views INTEGER DEFAULT 0,
    ypp_eligible INTEGER DEFAULT 0,
    last_synced_at TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS video_projects (
    id TEXT PRIMARY KEY,
    topic TEXT NOT NULL,
    format TEXT NOT NULL CHECK (format IN ('short', 'long')),
    language TEXT NOT NULL DEFAULT 'English',
    category TEXT DEFAULT 'Education',
    status TEXT NOT NULL CHECK (status IN (
      'researching', 'generating', 'editing', 'awaiting_approval',
      'approved', 'scheduled', 'uploaded', 'rejected', 'failed'
    )),
    script_text TEXT,
    title TEXT,
    description TEXT,
    hashtags TEXT,
    tags TEXT,
    thumbnail_path TEXT,
    video_path TEXT,
    audio_path TEXT,
    recommended_date TEXT,
    recommended_time TEXT,
    confidence_level TEXT,
    evidence_summary TEXT,
    youtube_video_id TEXT,
    retry_count INTEGER DEFAULT 0,
    error_message TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS comments_queue (
    comment_id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    video_title TEXT,
    author_name TEXT,
    comment_text TEXT NOT NULL,
    sentiment TEXT CHECK (sentiment IN ('positive', 'negative', 'spam', 'question', 'feedback')),
    suggested_reply TEXT,
    status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval', 'approved', 'posted', 'dismissed', 'failed')),
    error_message TEXT,
    published_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS daily_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_date TEXT UNIQUE NOT NULL,
    summary TEXT NOT NULL,
    strategy_json TEXT,
    metrics_json TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS ai_decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    step_name TEXT NOT NULL,
    decision TEXT NOT NULL,
    rationale TEXT,
    status TEXT DEFAULT 'completed',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

function setSetting(key, value) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(key, serialized);
}

module.exports = { db, getSetting, setSetting };
