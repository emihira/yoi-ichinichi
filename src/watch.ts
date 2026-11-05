// 5分ごとの見守り処理（仕様書 §3.4, §4, §7, §8）
// 「時刻ちょうど」ではなく「期限が来ていて未処理なら実行」。Cronが遅れても取りこぼさない。

import {
  addPushCount,
  applyNextSendTimes,
  cacheGreeting,
  claim,
  claimSetting,
  deleteExpired,
  getAdmin,
  getCachedGreeting,
  getDay,
  getPushCount,
  getSetting,
  listFamily,
  listParents,
  logFailure,
  logSend,
  markMorningFailed,
  markNoonNotified,
  setAdminNoticeResult,
  setSetting,
  toParentInfo,
  type UserRow,
} from './db';
import type { Env } from './env';
import { adminNoticePlan, isImportantKind, retryResultLabel } from './failure';
import { fallbackGreeting, fetchGreetingFromApi } from './greeting';
import { createLineClient, type LineClient, type LineMessage, type PushResult } from './line/client';
import { ADMIN_SEND_FAILED, familyMorningFailed, familyNoReply, morningMessage, REMINDER_STOPPED } from './line/messages';
import { effectivePushCount, isOverStopThreshold, retentionCutoffs } from './quota';
import { noonOutcome, shouldRunNoonCheck, shouldSendMorning, shouldSendReminder } from './rules';
import { toJst } from './time';

export interface Deps {
  db: D1Database;
  line: LineClient;
  greetingApiUrl: string;
  now: number;
}

export function depsFromEnv(env: Env, now = Date.now()): Deps {
  return {
    db: env.DB,
    line: createLineClient(env.LINE_CHANNEL_ACCESS_TOKEN),
    greetingApiUrl: env.GREETING_API_URL,
    now,
  };
}

export async function runWatch(deps: Deps): Promise<void> {
  const parents = await listParents(deps.db);
  for (const parent of parents) {
    try {
      await watchParent(deps, parent);
    } catch (e) {
      // 1人の失敗で、もう1人の見守りを止めない
      console.error('見守り処理でエラー', parent.id, e);
    }
  }
  await noticeReminderStop(deps);
}

/** 今月リマインドを止めたことを、家族全員に1回だけ知らせる（§11.4）。翌月は月が変わるので自動で再開 */
async function noticeReminderStop(deps: Deps): Promise<void> {
  if (!(await remindersSuspended(deps))) return;
  const month = toJst(deps.now).date.slice(0, 7);
  if (!(await claimSetting(deps.db, `reminder_stop_notified:${month}`, String(deps.now)))) return;
  await notifyFamily(deps, REMINDER_STOPPED, 'reminder_suspended');
}

/** 今月の送信数：自分で数えた値・LINE から取得した値（毎日4:00と「ようす」のときに更新）・判定に使う値 */
export async function monthlyUsage(deps: Deps): Promise<{ own: number; line: number | null; quota: number | null; effective: number }> {
  const month = toJst(deps.now).date.slice(0, 7);
  const own = await getPushCount(deps.db, month);
  const lineRaw = await getSetting(deps.db, `line_usage:${month}`);
  const quotaRaw = await getSetting(deps.db, `line_quota:${month}`);
  const line = lineRaw === null ? null : Number(lineRaw);
  const quota = quotaRaw === null ? null : Number(quotaRaw);
  return { own, line, quota, effective: effectivePushCount(own, line) };
}

/** LINE から今月の上限・消費数を取得して保存する（§11.2） */
export async function syncLineUsage(deps: Deps): Promise<void> {
  const month = toJst(deps.now).date.slice(0, 7);
  const { quota, used } = await deps.line.getUsage();
  if (used !== null) await setSetting(deps.db, `line_usage:${month}`, String(used));
  if (quota !== null) await setSetting(deps.db, `line_quota:${month}`, String(quota));
}

/** 毎日4:00の日次メンテナンス（§4, §11, §13.3） */
export async function runMaintenance(deps: Deps): Promise<void> {
  const steps: [string, () => Promise<unknown>][] = [
    ['送信数の照合', () => syncLineUsage(deps)],
    ['古いデータの削除', () => deleteExpired(deps.db, retentionCutoffs(deps.now, toJst(deps.now).date))],
    ['送信時刻の切り替え', () => applyNextSendTimes(deps.db)],
  ];
  for (const [name, step] of steps) {
    try {
      console.log('日次メンテナンス', name, JSON.stringify(await step()) ?? '');
    } catch (e) {
      // 1つの失敗で、ほかの処理を止めない
      console.error('日次メンテナンスでエラー', name, e);
    }
  }
}

async function watchParent(deps: Deps, parent: UserRow): Promise<void> {
  const { db, now } = deps;
  const today = toJst(now).date;
  const info = toParentInfo(parent);
  const day = await getDay(db, parent.id, today);

  // ① 朝の送信
  if (shouldSendMorning(info, day, now) && (await claim(db, parent.id, today, 'morning_sent_at', now))) {
    const greeting = await todaysGreeting(deps, today);
    const ok = await pushCounted(deps, parent, morningMessage(greeting), 'morning');
    if (!ok) await markMorningFailed(db, parent.id, today);
    return; // 送ったばかりなので、リマインド・正午判定は次回以降
  }

  // ② リマインド
  const suspended = await remindersSuspended(deps);
  if (shouldSendReminder(info, day, now, suspended) && (await claim(db, parent.id, today, 'reminder_sent_at', now))) {
    const greeting = await todaysGreeting(deps, today);
    await pushCounted(deps, parent, morningMessage(greeting, true), 'reminder');
  }

  // ③ 正午判定
  if (shouldRunNoonCheck(info, day, now) && (await claim(db, parent.id, today, 'noon_checked_at', now))) {
    // 判定の直前に読み直す（同じ時刻に届いた返信を見落として誤って通知しないため）
    const outcome = noonOutcome(await getDay(db, parent.id, today));
    if (outcome === 'replied') return;
    const name = parent.display_name ?? 'ご家族';
    const msg = outcome === 'morning_failed' ? familyMorningFailed(name) : familyNoReply(name);
    await notifyFamily(deps, msg, 'noon');
    await markNoonNotified(db, parent.id, today);
  }
}

/** その日の挨拶文：キャッシュ → 共通配信先 → 予備挨拶文 の順（§3.2, §3.3） */
export async function todaysGreeting(deps: Deps, today: string): Promise<string> {
  const cached = await getCachedGreeting(deps.db, today);
  if (cached) return cached;
  const fromApi = await fetchGreetingFromApi(deps.greetingApiUrl, today);
  const greeting = fromApi ?? fallbackGreeting(today);
  await cacheGreeting(deps.db, today, greeting, fromApi ? 'api' : 'fallback');
  return greeting;
}

/** 1人へ push し、送信数を数え、失敗を記録する */
async function pushCounted(deps: Deps, user: UserRow, msg: LineMessage, kind: string): Promise<boolean> {
  const { db, line, now } = deps;
  const r = await line.push(user.line_user_id, [msg], crypto.randomUUID());
  if (r.ok) await addPushCount(db, toJst(now).date.slice(0, 7), 1);
  await logSend(db, kind, now, 1, r.ok ? 1 : 0);
  if (!r.ok) await handleFailures(deps, kind, [{ user, result: r }]);
  return r.ok;
}

/**
 * 送れなかった相手を失敗履歴に記録し、重要な通知なら管理者へ1通だけ知らせる（§12.2〜§12.4）。
 * 管理者への通知も失敗したら、その結果も履歴に残す（「ようす」の末尾に件数が出る）
 */
async function handleFailures(deps: Deps, kind: string, failures: { user: UserRow; result: PushResult }[]): Promise<void> {
  const { db, line, now } = deps;
  const ids: number[] = [];
  for (const f of failures) {
    ids.push(await logFailure(db, kind, f.user.id, now, f.result.error, retryResultLabel(f.result)));
  }
  if (!isImportantKind(kind)) return;
  const admin = await getAdmin(db);
  const plan = adminNoticePlan(admin?.id ?? null, failures.map((f) => f.user.id));
  if (plan !== 'send' || !admin) return setAdminNoticeResult(db, ids, plan);
  const r = await line.push(admin.line_user_id, [ADMIN_SEND_FAILED], crypto.randomUUID());
  if (r.ok) await addPushCount(db, toJst(now).date.slice(0, 7), 1);
  await logSend(db, 'admin_alert', now, 1, r.ok ? 1 : 0);
  await setAdminNoticeResult(db, ids, r.ok ? 'sent' : `failed:${retryResultLabel(r)}`);
}

/** 家族全員へ1人ずつ push する。成功した人数を返す（§11.2） */
export async function notifyFamily(deps: Deps, msg: LineMessage, kind: string): Promise<{ target: number; success: number }> {
  const { db, line, now } = deps;
  const family = await listFamily(db);
  let success = 0;
  const failures: { user: UserRow; result: PushResult }[] = [];
  for (const f of family) {
    const r = await line.push(f.line_user_id, [msg], crypto.randomUUID());
    if (r.ok) success++;
    else failures.push({ user: f, result: r });
  }
  await addPushCount(db, toJst(now).date.slice(0, 7), success);
  await logSend(db, kind, now, family.length, success);
  if (failures.length > 0) await handleFailures(deps, kind, failures);
  return { target: family.length, success };
}

/** 今月の送信数が上限の目安を超えたか。超えたらリマインドと「入力がありました」を止め、朝のメッセージと大事な通知に枠を残す */
export async function remindersSuspended(deps: Deps): Promise<boolean> {
  return isOverStopThreshold((await monthlyUsage(deps)).effective);
}

// ---- デモモード（§16.2）：DEMO_MODE=true のときだけ、管理者が使える ----
// 時刻や「登録した当日は送らない」の決まりを無視して、すぐに実行する。対象は登録済みの親全員。

export type DemoCommand = 'morning' | 'reminder' | 'noon' | 'reset';

export async function runDemo(deps: Deps, command: DemoCommand): Promise<string> {
  const { db, now } = deps;
  const today = toJst(now).date;
  const parents = await listParents(db);
  if (parents.length === 0) return '親御さんがまだ登録されていません。';
  const results: string[] = [];

  for (const parent of parents) {
    const name = parent.display_name ?? 'ご家族';
    if (command === 'reset') {
      await db.prepare(`DELETE FROM daily_status WHERE parent_id = ? AND date = ?`).bind(parent.id, today).run();
      results.push(`${name}：今日の記録を消しました`);
      continue;
    }
    const day = await getDay(db, parent.id, today);
    const greeting = await todaysGreeting(deps, today);

    if (command === 'morning') {
      await db
        .prepare(`UPDATE daily_status SET morning_sent_at = ?, morning_failed = 0 WHERE parent_id = ? AND date = ?`)
        .bind(now, parent.id, today)
        .run();
      const ok = await pushCounted(deps, parent, morningMessage(greeting), 'morning');
      if (!ok) await markMorningFailed(db, parent.id, today);
      results.push(`${name}：朝のメッセージを${ok ? '送りました' : '送れませんでした'}`);
    } else if (command === 'reminder') {
      if (day.firstReplyAt !== null) {
        results.push(`${name}：お返事があるので、リマインドは送りません`);
        continue;
      }
      await db
        .prepare(`UPDATE daily_status SET reminder_sent_at = ? WHERE parent_id = ? AND date = ?`)
        .bind(now, parent.id, today)
        .run();
      const ok = await pushCounted(deps, parent, morningMessage(greeting, true), 'reminder');
      results.push(`${name}：リマインドを${ok ? '送りました' : '送れませんでした'}`);
    } else {
      await db
        .prepare(`UPDATE daily_status SET noon_checked_at = ? WHERE parent_id = ? AND date = ?`)
        .bind(now, parent.id, today)
        .run();
      const outcome = noonOutcome(day);
      if (outcome === 'replied') {
        results.push(`${name}：お返事があるので、お知らせは送りません`);
        continue;
      }
      const msg = outcome === 'morning_failed' ? familyMorningFailed(name) : familyNoReply(name);
      const { success, target } = await notifyFamily(deps, msg, 'noon');
      await markNoonNotified(db, parent.id, today);
      results.push(`${name}：ご家族${target}人中${success}人にお知らせしました`);
    }
  }
  return `【デモ】\n${results.join('\n')}`;
}
