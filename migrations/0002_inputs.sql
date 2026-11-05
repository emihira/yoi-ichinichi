-- 親からの入力の記録（11/5 の仕様変更）
-- 親は「声や文字が家族に届いている」と思っている可能性が高いため、入力があったら家族に知らせ、
-- 内容は「ようす」で確かめられるようにする。§13.2（本文を保存しない）をこの範囲で変更：
--   文字：本文を保存（300文字まで）、声：長さ（秒）だけ、スタンプ・写真など：種類だけ。
--   保存は7日間。毎日4:00の日次メンテナンスで古いものを消す。

CREATE TABLE inputs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id   INTEGER NOT NULL REFERENCES users(id),
  received_at INTEGER NOT NULL,
  kind        TEXT NOT NULL,
  detail      TEXT
);
CREATE INDEX idx_inputs_parent_time ON inputs(parent_id, received_at);

-- 「入力がありました」を最後に家族へ知らせた時刻（1時間に1回まで）
ALTER TABLE users ADD COLUMN input_notified_at INTEGER;
