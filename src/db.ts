// D1（データベース）の読み書き（仕様書 §13）
// 二重送信を防ぐため、送信の前に「実行済みの日時がまだ空のときだけ書き込む」更新を行い、
// それが成功した（1行変わった）ときだけ送信する（§13.4）。

import type { DayState, ParentInfo, ParentStatus, ReplyMethod } from './rules';

export interface UserRow {
  id: number;
  line_user_id: string;
  role: 'parent' | 'family';
  is_admin: number;
  display_name: string | null;
  send_time: string | null;
  send_time_next: string | null;
  status: ParentStatus;
  pause_until: string | null;
  created_at: number;
  registered_date: string;
}

export function toParentInfo(u: UserRow): ParentInfo {
  return {
    sendTime: u.send_time ?? '08:00',
    status: u.status,
    pauseUntil: u.pause_until,
    registeredDate: u.registered_date,
  };
}

// ---- 利用者 ----

export async function getUserByLineId(db: D1Database, lineUserId: string): Promise<UserRow | null> {
  return db
    .prepare(`SELECT * FROM users WHERE line_user_id = ? AND status != 'removed'`)
    .bind(lineUserId)
    .first<UserRow>();
}

export async function listParents(db: D1Database): Promise<UserRow[]> {
  const r = await db.prepare(`SELECT * FROM users WHERE role = 'parent' AND status = 'active'`).all<UserRow>();
  return r.results;
}

export async function listFamily(db: D1Database): Promise<UserRow[]> {
  const r = await db
    .prepare(`SELECT * FROM users WHERE role = 'family' AND status = 'active' ORDER BY id`)
    .all<UserRow>();
  return r.results;
}

export async function hasAdmin(db: D1Database): Promise<boolean> {
  const r = await db.prepare(`SELECT 1 FROM users WHERE is_admin = 1 AND status != 'removed'`).first();
  return r !== null;
}

/** 管理者がまだいない場合に限り、管理者として登録する（§9.2）。登録できたら true */
export async function registerAdmin(
  db: D1Database,
  lineUserId: string,
  now: number,
  today: string,
): Promise<boolean> {
  const r = await db
    .prepare(
      `INSERT INTO users (line_user_id, role, is_admin, status, created_at, registered_date)
       SELECT ?, 'family', 1, 'active', ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM users WHERE is_admin = 1 AND status != 'removed')`,
    )
    .bind(lineUserId, now, today)
    .run();
  return r.meta.changes === 1;
}

// ---- 親ごと・日ごとの状態 ----

interface DayRow {
  morning_sent_at: number | null;
  morning_failed: number;
  reminder_sent_at: number | null;
  noon_checked_at: number | null;
  first_reply_at: number | null;
  unwell_notified_at: number | null;
  unwell_cancelled_at: number | null;
}

export interface DayRecord extends DayState {
  unwellNotifiedAt: number | null;
  unwellCancelledAt: number | null;
}

export async function getDay(db: D1Database, parentId: number, date: string): Promise<DayRecord> {
  await db
    .prepare(`INSERT INTO daily_status (parent_id, date) VALUES (?, ?) ON CONFLICT DO NOTHING`)
    .bind(parentId, date)
    .run();
  const r = await db
    .prepare(`SELECT * FROM daily_status WHERE parent_id = ? AND date = ?`)
    .bind(parentId, date)
    .first<DayRow>();
  if (!r) throw new Error('daily_status を作成できませんでした');
  return {
    morningSentAt: r.morning_sent_at,
    morningFailed: r.morning_failed === 1,
    reminderSentAt: r.reminder_sent_at,
    noonCheckedAt: r.noon_checked_at,
    firstReplyAt: r.first_reply_at,
    unwellNotifiedAt: r.unwell_notified_at,
    unwellCancelledAt: r.unwell_cancelled_at,
  };
}

const CLAIMABLE = ['morning_sent_at', 'reminder_sent_at', 'noon_checked_at'] as const;
export type ClaimColumn = (typeof CLAIMABLE)[number];

/** 「まだ空なら今の日時を書き込む」。書き込めたら true（＝この処理が送信を担当する） */
export async function claim(
  db: D1Database,
  parentId: number,
  date: string,
  column: ClaimColumn,
  now: number,
): Promise<boolean> {
  if (!CLAIMABLE.includes(column)) throw new Error(`不正な列: ${column}`);
  const r = await db
    .prepare(`UPDATE daily_status SET ${column} = ? WHERE parent_id = ? AND date = ? AND ${column} IS NULL`)
    .bind(now, parentId, date)
    .run();
  return r.meta.changes === 1;
}

export async function markMorningFailed(db: D1Database, parentId: number, date: string): Promise<void> {
  await db
    .prepare(`UPDATE daily_status SET morning_failed = 1 WHERE parent_id = ? AND date = ?`)
    .bind(parentId, date)
    .run();
}

export async function markNoonNotified(db: D1Database, parentId: number, date: string): Promise<void> {
  await db
    .prepare(`UPDATE daily_status SET noon_notified = 1 WHERE parent_id = ? AND date = ?`)
    .bind(parentId, date)
    .run();
}

/** その日最初の有効な返信を記録する。最初の返信だったら true */
export async function recordFirstReply(
  db: D1Database,
  parentId: number,
  date: string,
  now: number,
  method: ReplyMethod,
): Promise<boolean> {
  await getDay(db, parentId, date);
  const r = await db
    .prepare(
      `UPDATE daily_status SET first_reply_at = ?, reply_method = ?
       WHERE parent_id = ? AND date = ? AND first_reply_at IS NULL`,
    )
    .bind(now, method, parentId, date)
    .run();
  return r.meta.changes === 1;
}

export async function markThanksSent(db: D1Database, parentId: number, date: string): Promise<void> {
  await db
    .prepare(`UPDATE daily_status SET thanks_sent = 1 WHERE parent_id = ? AND date = ?`)
    .bind(parentId, date)
    .run();
}

// ---- イベントの二重処理防止 ----

/** 初めて見るイベントなら記録して true。処理済みなら false */
export async function markEventProcessed(db: D1Database, eventId: string, now: number): Promise<boolean> {
  const r = await db
    .prepare(`INSERT INTO processed_events (webhook_event_id, processed_at) VALUES (?, ?) ON CONFLICT DO NOTHING`)
    .bind(eventId, now)
    .run();
  return r.meta.changes === 1;
}

// ---- 挨拶文のキャッシュ ----

export async function getCachedGreeting(db: D1Database, date: string): Promise<string | null> {
  const r = await db.prepare(`SELECT greeting FROM greetings_cache WHERE date = ?`).bind(date).first<{ greeting: string }>();
  return r?.greeting ?? null;
}

export async function cacheGreeting(db: D1Database, date: string, greeting: string, source: 'api' | 'fallback') {
  await db
    .prepare(`INSERT INTO greetings_cache (date, greeting, source) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`)
    .bind(date, greeting, source)
    .run();
}

// ---- 送信数（§11.2）：pushを送るたびに「成功した人数」を足す ----

export async function addPushCount(db: D1Database, month: string, count: number): Promise<void> {
  if (count <= 0) return;
  await db
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + excluded.value`,
    )
    .bind(`push_count:${month}`, String(count))
    .run();
}

export async function getPushCount(db: D1Database, month: string): Promise<number> {
  const r = await db.prepare(`SELECT value FROM settings WHERE key = ?`).bind(`push_count:${month}`).first<{ value: string }>();
  return r ? Number(r.value) : 0;
}

export async function logSend(db: D1Database, kind: string, now: number, target: number, success: number) {
  await db
    .prepare(`INSERT INTO send_log (sent_at, kind, target_count, success_count) VALUES (?, ?, ?, ?)`)
    .bind(now, kind, target, success)
    .run();
}

/** 失敗履歴を記録し、その行のIDを返す（§12.4） */
export async function logFailure(
  db: D1Database,
  kind: string,
  targetUser: number | null,
  now: number,
  error: string | undefined,
  retryResult: string | null = null,
): Promise<number> {
  const r = await db
    .prepare(`INSERT INTO notification_failures (kind, target_user, failed_at, error, retry_result) VALUES (?, ?, ?, ?, ?)`)
    .bind(kind, targetUser, now, error ?? null, retryResult)
    .run();
  return Number(r.meta.last_row_id);
}

/** 管理者への通知の結果を、失敗履歴に書き足す（§12.3, §12.4） */
export async function setAdminNoticeResult(db: D1Database, failureIds: number[], result: string): Promise<void> {
  if (failureIds.length === 0) return;
  await db.batch(
    failureIds.map((id) => db.prepare(`UPDATE notification_failures SET admin_notice = ? WHERE id = ?`).bind(result, id)),
  );
}

export async function getAdmin(db: D1Database): Promise<UserRow | null> {
  return db.prepare(`SELECT * FROM users WHERE is_admin = 1 AND status = 'active'`).first<UserRow>();
}

// ---- 登録（§9） ----

export async function countUsers(db: D1Database, role: 'parent' | 'family'): Promise<number> {
  const r = await db
    .prepare(`SELECT COUNT(*) AS n FROM users WHERE role = ? AND status != 'removed'`)
    .bind(role)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

export async function insertUser(
  db: D1Database,
  u: { lineUserId: string; role: 'parent' | 'family'; displayName: string | null; sendTime: string | null },
  now: number,
  today: string,
): Promise<number> {
  const r = await db
    .prepare(
      `INSERT INTO users (line_user_id, role, is_admin, display_name, send_time, status, created_at, registered_date)
       VALUES (?, ?, 0, ?, ?, 'active', ?, ?)`,
    )
    .bind(u.lineUserId, u.role, u.displayName, u.sendTime, now, today)
    .run();
  return Number(r.meta.last_row_id);
}

export interface InviteRow {
  id: number;
  kind: 'family' | 'parent';
  parent_name: string | null;
  expires_at: number;
  used_at: number | null;
}

export async function createInvite(
  db: D1Database,
  inv: { kind: 'family' | 'parent'; codeHash: string; parentName: string | null; expiresAt: number; issuedBy: number },
  now: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO invites (kind, code_hash, parent_name, expires_at, issued_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(inv.kind, inv.codeHash, inv.parentName, inv.expiresAt, inv.issuedBy, now)
    .run();
}

export async function findInvite(db: D1Database, codeHash: string): Promise<InviteRow | null> {
  return db
    .prepare(`SELECT id, kind, parent_name, expires_at, used_at FROM invites WHERE code_hash = ?`)
    .bind(codeHash)
    .first<InviteRow>();
}

/** 招待コードを「使用済み」にする。まだ使われていなかったときだけ true（同時に2人が使えないように） */
export async function useInvite(db: D1Database, inviteId: number, now: number): Promise<boolean> {
  const r = await db
    .prepare(`UPDATE invites SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?`)
    .bind(now, inviteId, now)
    .run();
  return r.meta.changes === 1;
}

export async function recentInviteAttempts(db: D1Database, lineUserId: string, since: number): Promise<number[]> {
  const r = await db
    .prepare(`SELECT attempted_at FROM invite_attempts WHERE line_user_id = ? AND attempted_at > ?`)
    .bind(lineUserId, since)
    .all<{ attempted_at: number }>();
  return r.results.map((x) => x.attempted_at);
}

export async function addInviteAttempt(db: D1Database, lineUserId: string, now: number): Promise<void> {
  await db.prepare(`INSERT INTO invite_attempts (line_user_id, attempted_at) VALUES (?, ?)`).bind(lineUserId, now).run();
}

// ---- 複数手順の操作の途中状態（§10.1：10分で無効） ----

export interface ConversationState {
  operation: string;
  parent_id: number | null;
}

export async function getConversation(db: D1Database, lineUserId: string, now: number): Promise<ConversationState | null> {
  return db
    .prepare(`SELECT operation, parent_id FROM conversation_state WHERE line_user_id = ? AND expires_at > ?`)
    .bind(lineUserId, now)
    .first<ConversationState>();
}

export async function setConversation(
  db: D1Database,
  lineUserId: string,
  operation: string,
  parentId: number | null,
  expiresAt: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO conversation_state (line_user_id, operation, parent_id, expires_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(line_user_id) DO UPDATE SET operation = excluded.operation, parent_id = excluded.parent_id, expires_at = excluded.expires_at`,
    )
    .bind(lineUserId, operation, parentId, expiresAt)
    .run();
}

export async function clearConversation(db: D1Database, lineUserId: string): Promise<void> {
  await db.prepare(`DELETE FROM conversation_state WHERE line_user_id = ?`).bind(lineUserId).run();
}

// ---- 不調ボタン（§6） ----

/** 不調通知の担当を取る：前回の通知から30分以上たっていれば日時を書き込み true */
export async function claimUnwellNotice(
  db: D1Database,
  parentId: number,
  date: string,
  now: number,
  debounceMs: number,
): Promise<boolean> {
  const r = await db
    .prepare(
      `UPDATE daily_status SET unwell_notified_at = ?
       WHERE parent_id = ? AND date = ? AND (unwell_notified_at IS NULL OR unwell_notified_at <= ?)`,
    )
    .bind(now, parentId, date, now - debounceMs)
    .run();
  return r.meta.changes === 1;
}

/** 押し間違いの取り消しを記録する。まだ取り消していなかったときだけ true */
export async function claimUnwellCancel(db: D1Database, parentId: number, date: string, now: number): Promise<boolean> {
  const r = await db
    .prepare(
      `UPDATE daily_status SET unwell_cancelled_at = ?
       WHERE parent_id = ? AND date = ? AND unwell_notified_at IS NOT NULL
         AND (unwell_cancelled_at IS NULL OR unwell_cancelled_at < unwell_notified_at)`,
    )
    .bind(now, parentId, date)
    .run();
  return r.meta.changes === 1;
}

/** 家族の全員に送れなかったときは、不調通知の記録を戻す（次に押されたとき、もう一度送れるように） */
export async function resetUnwellNotice(db: D1Database, parentId: number, date: string, at: number): Promise<void> {
  await db
    .prepare(`UPDATE daily_status SET unwell_notified_at = NULL WHERE parent_id = ? AND date = ? AND unwell_notified_at = ?`)
    .bind(parentId, date, at)
    .run();
}

// ---- ようす（§10.2, §12.4） ----

/** 「ようす」に表示する親（ブロック中も含める） */
export async function listParentsForStatus(db: D1Database): Promise<UserRow[]> {
  const r = await db
    .prepare(`SELECT * FROM users WHERE role = 'parent' AND status != 'removed' ORDER BY id`)
    .all<UserRow>();
  return r.results;
}

export async function getDaysRange(
  db: D1Database,
  parentId: number,
  from: string,
  to: string,
): Promise<import('./status').StatusDay[]> {
  const r = await db
    .prepare(`SELECT * FROM daily_status WHERE parent_id = ? AND date BETWEEN ? AND ? ORDER BY date`)
    .bind(parentId, from, to)
    .all<DayRow & { date: string; reply_method: ReplyMethod | null }>();
  return r.results.map((d) => ({
    date: d.date,
    morningSentAt: d.morning_sent_at,
    morningFailed: d.morning_failed === 1,
    reminderSentAt: d.reminder_sent_at,
    noonCheckedAt: d.noon_checked_at,
    firstReplyAt: d.first_reply_at,
    replyMethod: d.reply_method,
    unwellNotifiedAt: d.unwell_notified_at,
    unwellCancelledAt: d.unwell_cancelled_at,
  }));
}

export async function countFailuresSince(db: D1Database, since: number): Promise<number> {
  const r = await db
    .prepare(`SELECT COUNT(*) AS n FROM notification_failures WHERE failed_at >= ?`)
    .bind(since)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

// ---- 親からの入力の記録（11/5 の仕様変更。migrations/0002_inputs.sql） ----

export async function insertInput(
  db: D1Database,
  parentId: number,
  kind: string,
  detail: string | null,
  now: number,
): Promise<void> {
  await db
    .prepare(`INSERT INTO inputs (parent_id, received_at, kind, detail) VALUES (?, ?, ?, ?)`)
    .bind(parentId, now, kind, detail)
    .run();
}

/** 「入力がありました」を送る権利を取る。前回から intervalMs 以内なら false（同時に届いても1回だけ） */
export async function claimInputNotice(db: D1Database, parentId: number, now: number, intervalMs: number): Promise<boolean> {
  const r = await db
    .prepare(
      `UPDATE users SET input_notified_at = ?
       WHERE id = ? AND (input_notified_at IS NULL OR input_notified_at <= ?)`,
    )
    .bind(now, parentId, now - intervalMs)
    .run();
  return r.meta.changes === 1;
}

export interface InputRow {
  kind: string;
  detail: string | null;
  received_at: number;
}

/** 新しい順に limit 件 */
export async function listRecentInputs(db: D1Database, parentId: number, since: number, limit: number): Promise<InputRow[]> {
  const r = await db
    .prepare(
      `SELECT kind, detail, received_at FROM inputs
       WHERE parent_id = ? AND received_at >= ? ORDER BY received_at DESC LIMIT ?`,
    )
    .bind(parentId, since, limit)
    .all<InputRow>();
  return r.results;
}

// ---- 送信数の照合と日次メンテナンス（§11, §13.3） ----

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const r = await db.prepare(`SELECT value FROM settings WHERE key = ?`).bind(key).first<{ value: string }>();
  return r ? r.value : null;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .bind(key, value)
    .run();
}

/** まだ無ければ書き込み、書き込めたら true（1回だけ行う処理の権利を取る） */
export async function claimSetting(db: D1Database, key: string, value: string): Promise<boolean> {
  const r = await db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT DO NOTHING`).bind(key, value).run();
  return r.meta.changes === 1;
}

/** 保存期間を過ぎたデータを消す。表ごとに消した件数を返す */
export async function deleteExpired(
  db: D1Database,
  c: import('./quota').RetentionCutoffs,
): Promise<Record<string, number>> {
  const statements: [string, D1PreparedStatement][] = [
    ['daily_status', db.prepare(`DELETE FROM daily_status WHERE date < ?`).bind(c.dailyStatusBeforeDate)],
    ['send_log', db.prepare(`DELETE FROM send_log WHERE sent_at < ?`).bind(c.sendLogBefore)],
    ['notification_failures', db.prepare(`DELETE FROM notification_failures WHERE failed_at < ?`).bind(c.failuresBefore)],
    ['processed_events', db.prepare(`DELETE FROM processed_events WHERE processed_at < ?`).bind(c.weekBefore)],
    ['inputs', db.prepare(`DELETE FROM inputs WHERE received_at < ?`).bind(c.weekBefore)],
    ['invite_attempts', db.prepare(`DELETE FROM invite_attempts WHERE attempted_at < ?`).bind(c.weekBefore)],
    [
      'invites',
      db.prepare(`DELETE FROM invites WHERE expires_at < ? OR (used_at IS NOT NULL AND used_at < ?)`).bind(c.invitesBefore, c.invitesBefore),
    ],
    ['conversation_state', db.prepare(`DELETE FROM conversation_state WHERE expires_at < ?`).bind(c.conversationBefore)],
  ];
  const results = await db.batch(statements.map(([, s]) => s));
  return Object.fromEntries(statements.map(([name], i) => [name, results[i]?.meta.changes ?? 0]));
}

/** 翌日から適用する送信時刻を、今日の送信時刻に切り替える（§10「じかん」） */
export async function applyNextSendTimes(db: D1Database): Promise<number> {
  const r = await db
    .prepare(`UPDATE users SET send_time = send_time_next, send_time_next = NULL WHERE send_time_next IS NOT NULL`)
    .run();
  return r.meta.changes;
}

// ---- 家族の操作（§10.3, §10.4） ----

/** 登録中の親を1人読む（ボタンの中の親IDは書き換えられうるので、必ず親であることを確かめる） */
export async function getParentById(db: D1Database, id: number): Promise<UserRow | null> {
  return db.prepare(`SELECT * FROM users WHERE id = ? AND role = 'parent' AND status != 'removed'`).bind(id).first<UserRow>();
}

/** 休止の最終日を設定する（この日まで休止。翌朝から再開） */
export async function setPauseUntil(db: D1Database, parentId: number, until: string): Promise<void> {
  await db.prepare(`UPDATE users SET pause_until = ? WHERE id = ? AND role = 'parent'`).bind(until, parentId).run();
}

/** 送信時刻を変える。today=true なら今日から、false なら翌日から（4:00 の日次処理で切り替え） */
export async function setSendTime(db: D1Database, parentId: number, hhmm: string, today: boolean): Promise<void> {
  const sql = today
    ? `UPDATE users SET send_time = ?, send_time_next = NULL WHERE id = ? AND role = 'parent'`
    : `UPDATE users SET send_time_next = ? WHERE id = ? AND role = 'parent'`;
  await db.prepare(sql).bind(hhmm, parentId).run();
}

// ---- ブロック・友だち削除（§9.7） ----

/** 親の状態を切り替える（active ⇔ blocked）。切り替わったら true（同じ通知を2回送らないため） */
export async function setParentBlocked(db: D1Database, parentId: number, blocked: boolean): Promise<boolean> {
  const [to, from] = blocked ? ['blocked', 'active'] : ['active', 'blocked'];
  const r = await db
    .prepare(`UPDATE users SET status = ? WHERE id = ? AND role = 'parent' AND status = ?`)
    .bind(to, parentId, from)
    .run();
  return r.meta.changes === 1;
}
