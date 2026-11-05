-- 写真もお返事に数える（11/5 の仕様変更。§5.1 を変更）
-- SQLite は CHECK 制約を変更できないため、daily_status を作り直して中身を移す。

PRAGMA defer_foreign_keys = true;

CREATE TABLE daily_status_new (
  parent_id           INTEGER NOT NULL REFERENCES users(id),
  date                TEXT NOT NULL,
  morning_sent_at     INTEGER,
  morning_failed      INTEGER NOT NULL DEFAULT 0,
  reminder_sent_at    INTEGER,
  noon_checked_at     INTEGER,
  noon_notified       INTEGER NOT NULL DEFAULT 0,
  first_reply_at      INTEGER,
  reply_method        TEXT CHECK (reply_method IN ('voice', 'button_ok', 'button_unwell', 'text', 'sticker', 'image')),
  thanks_sent         INTEGER NOT NULL DEFAULT 0,
  unwell_notified_at  INTEGER,
  unwell_cancelled_at INTEGER,
  PRIMARY KEY (parent_id, date)
);

INSERT INTO daily_status_new
  (parent_id, date, morning_sent_at, morning_failed, reminder_sent_at, noon_checked_at, noon_notified,
   first_reply_at, reply_method, thanks_sent, unwell_notified_at, unwell_cancelled_at)
SELECT parent_id, date, morning_sent_at, morning_failed, reminder_sent_at, noon_checked_at, noon_notified,
   first_reply_at, reply_method, thanks_sent, unwell_notified_at, unwell_cancelled_at
FROM daily_status;

DROP TABLE daily_status;
ALTER TABLE daily_status_new RENAME TO daily_status;
