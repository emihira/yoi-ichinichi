-- よい一日のはじまりに：データベースの初期化（仕様書 §13.1）
-- 日時はすべて UNIX ミリ秒（UTC）の整数で保存する。日付（date）は日本時間の 'YYYY-MM-DD'。
-- 音声・文字の本文・スタンプID・送信本文は保存しない（§13.2）。

CREATE TABLE users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  line_user_id    TEXT NOT NULL UNIQUE,
  role            TEXT NOT NULL CHECK (role IN ('parent', 'family')),
  is_admin        INTEGER NOT NULL DEFAULT 0,
  display_name    TEXT,                         -- 親の呼び名
  send_time       TEXT,                         -- 親の朝の送信時刻 'HH:MM'
  send_time_next  TEXT,                         -- 翌日から適用する送信時刻
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked', 'removed')),
  pause_until     TEXT,                         -- 休止の最終日（この日まで休止。翌朝から再開）
  created_at      INTEGER NOT NULL,
  registered_date TEXT NOT NULL                 -- 登録日（日本時間）。この日は見守り処理をしない
);

CREATE TABLE daily_status (
  parent_id           INTEGER NOT NULL REFERENCES users(id),
  date                TEXT NOT NULL,
  morning_sent_at     INTEGER,
  morning_failed      INTEGER NOT NULL DEFAULT 0,
  reminder_sent_at    INTEGER,
  noon_checked_at     INTEGER,
  noon_notified       INTEGER NOT NULL DEFAULT 0,
  first_reply_at      INTEGER,
  reply_method        TEXT CHECK (reply_method IN ('voice', 'button_ok', 'button_unwell', 'text', 'sticker')),
  thanks_sent         INTEGER NOT NULL DEFAULT 0,
  unwell_notified_at  INTEGER,
  unwell_cancelled_at INTEGER,
  PRIMARY KEY (parent_id, date)
);

CREATE TABLE greetings_cache (
  date     TEXT PRIMARY KEY,
  greeting TEXT NOT NULL,
  source   TEXT NOT NULL CHECK (source IN ('api', 'fallback'))
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE send_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sent_at       INTEGER NOT NULL,
  kind          TEXT NOT NULL,   -- morning / reminder / noon / unwell / unwell_cancel / blocked / admin_alert / reminder_suspended
  target_count  INTEGER NOT NULL,
  success_count INTEGER NOT NULL
);

CREATE TABLE processed_events (
  webhook_event_id TEXT PRIMARY KEY,
  processed_at     INTEGER NOT NULL
);

CREATE TABLE invites (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL CHECK (kind IN ('family', 'parent')),
  code_hash    TEXT NOT NULL UNIQUE,
  parent_name  TEXT,
  expires_at   INTEGER NOT NULL,
  used_at      INTEGER,
  issued_by    INTEGER NOT NULL REFERENCES users(id),
  created_at   INTEGER NOT NULL
);

CREATE TABLE invite_attempts (
  line_user_id TEXT NOT NULL,
  attempted_at INTEGER NOT NULL
);
CREATE INDEX idx_invite_attempts ON invite_attempts (line_user_id, attempted_at);

CREATE TABLE conversation_state (
  line_user_id TEXT PRIMARY KEY,
  operation    TEXT NOT NULL,
  parent_id    INTEGER,
  expires_at   INTEGER NOT NULL
);

CREATE TABLE notification_failures (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL,
  target_user  INTEGER,
  failed_at    INTEGER NOT NULL,
  error        TEXT,
  retry_result TEXT,
  admin_notice TEXT
);
