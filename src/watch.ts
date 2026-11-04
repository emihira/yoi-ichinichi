// 5分ごとの見守り処理（仕様書 §3.4, §4, §7, §8）
// 「時刻ちょうど」ではなく「期限が来ていて未処理なら実行」。Cronが遅れても取りこぼさない。

import {
  addPushCount,
  cacheGreeting,
  claim,
  getCachedGreeting,
  getDay,
  getPushCount,
  listFamily,
  listParents,
  logFailure,
  logSend,
  markMorningFailed,
  markNoonNotified,
  toParentInfo,
  type UserRow,
} from './db';
import type { Env } from './env';
import { fallbackGreeting, fetchGreetingFromApi } from './greeting';
import { createLineClient, type LineClient, type LineMessage } from './line/client';
import { familyMorningFailed, familyNoReply, morningMessage } from './line/messages';
import { noonOutcome, shouldRunNoonCheck, shouldSendMorning, shouldSendReminder } from './rules';
import { toJst } from './time';

export const REMINDER_STOP_THRESHOLD = 150;

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
  const suspended = (await getPushCount(db, today.slice(0, 7))) > REMINDER_STOP_THRESHOLD;
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
  else await logFailure(db, kind, user.id, now, r.error);
  await logSend(db, kind, now, 1, r.ok ? 1 : 0);
  return r.ok;
}

/** 家族全員へ1人ずつ push する。成功した人数を返す（§11.2） */
export async function notifyFamily(deps: Deps, msg: LineMessage, kind: string): Promise<{ target: number; success: number }> {
  const { db, line, now } = deps;
  const family = await listFamily(db);
  let success = 0;
  for (const f of family) {
    const r = await line.push(f.line_user_id, [msg], crypto.randomUUID());
    if (r.ok) success++;
    else await logFailure(db, kind, f.id, now, r.error);
  }
  await addPushCount(db, toJst(now).date.slice(0, 7), success);
  await logSend(db, kind, now, family.length, success);
  return { target: family.length, success };
}
