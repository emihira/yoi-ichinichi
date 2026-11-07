-- 親の声の返事の録音（11/7 の仕様変更）
-- 管理者が「こえ」と送ると、最近の録音を LINE の音声メッセージで聞ける。
-- §13.2 をこの範囲で変更：声は録音そのものを保存する（1件 1.5MB まで）。保存は7日間で、
-- 毎日4:00の日次メンテナンスで古いものを消す。聞けるのは管理者だけ。

CREATE TABLE voice_clips (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id    INTEGER NOT NULL REFERENCES users(id),
  received_at  INTEGER NOT NULL,
  duration_ms  INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  data         BLOB NOT NULL
);
CREATE INDEX idx_voice_clips_time ON voice_clips(received_at);
