// 見守りの判定ロジック（仕様書 §3.4, §5, §6, §7, §8）
// LINE や D1 には触れない「純粋な関数」だけを置く。現在時刻は引数で受け取るので、
// 実際の時刻を待たずに自動テストで確かめられる（§19.5）。

import { addDays, MINUTE_MS, parseHHMM, toJst } from './time';

export const NOON_MINUTES = 12 * 60;
export const REMINDER_DELAY_MS = 60 * MINUTE_MS;
export const UNWELL_DEBOUNCE_MS = 30 * MINUTE_MS;

export type ParentStatus = 'active' | 'blocked' | 'removed';

/** 判定に必要な親の情報 */
export interface ParentInfo {
  sendTime: string; // 'HH:MM'
  status: ParentStatus;
  /** 休止の最終日（日本時間）。この日まで休止し、翌朝から再開 */
  pauseUntil: string | null;
  /** 登録日（日本時間）。登録した当日は見守り処理をしない */
  registeredDate: string;
}

/** 親ごと・日ごとの状態（daily_status の1行） */
export interface DayState {
  morningSentAt: number | null;
  morningFailed: boolean;
  reminderSentAt: number | null;
  noonCheckedAt: number | null;
  firstReplyAt: number | null;
}

export const EMPTY_DAY: DayState = {
  morningSentAt: null,
  morningFailed: false,
  reminderSentAt: null,
  noonCheckedAt: null,
  firstReplyAt: null,
};

/** 見守りの1日が始まる時刻（朝の送信時刻の下限と同じ 5:00） */
export const DAY_START_MINUTES = 5 * 60;

/**
 * 登録日（日本時間）。午前5時より前の登録は前日の登録として扱う。
 * 夜中の0時過ぎに登録しても、その日の朝から見守りが始まるようにするため。
 */
export function registrationDate(now: number): string {
  const jst = toJst(now);
  return jst.minutes < DAY_START_MINUTES ? addDays(jst.date, -1) : jst.date;
}

/** 休止中か（休止の最終日の当日までが休止） */
export function isPaused(parent: ParentInfo, today: string): boolean {
  return parent.pauseUntil !== null && today <= parent.pauseUntil;
}

/** 今日、この親を見守り処理の対象にするか */
export function isWatchedToday(parent: ParentInfo, today: string): boolean {
  if (parent.status !== 'active') return false;
  // 登録した当日は対象外（登録完了の文面「あしたの朝から」と合わせる）
  if (today <= parent.registeredDate) return false;
  return !isPaused(parent, today);
}

/** 朝の送信：送信時刻を過ぎていて、今日まだ送っていなければ送る（Cronが遅れても送る） */
export function shouldSendMorning(parent: ParentInfo, day: DayState, now: number): boolean {
  const jst = toJst(now);
  if (!isWatchedToday(parent, jst.date)) return false;
  if (day.morningSentAt !== null) return false;
  return jst.minutes >= parseHHMM(parent.sendTime);
}

/** リマインド：朝の送信から60分後に未返信なら1回だけ送る（§7） */
export function shouldSendReminder(
  parent: ParentInfo,
  day: DayState,
  now: number,
  remindersSuspended: boolean,
): boolean {
  const jst = toJst(now);
  if (!isWatchedToday(parent, jst.date)) return false;
  if (remindersSuspended) return false;
  if (day.morningSentAt === null || day.morningFailed) return false;
  if (day.firstReplyAt !== null) return false;
  if (day.reminderSentAt !== null) return false;
  if (jst.minutes >= NOON_MINUTES) return false;
  return now >= day.morningSentAt + REMINDER_DELAY_MS;
}

export type NoonOutcome = 'replied' | 'no_reply' | 'morning_failed';

/** 正午判定を今行うか：12:00以降で、今日まだ判定していなければ行う（§8） */
export function shouldRunNoonCheck(parent: ParentInfo, day: DayState, now: number): boolean {
  const jst = toJst(now);
  if (!isWatchedToday(parent, jst.date)) return false;
  if (day.noonCheckedAt !== null) return false;
  return jst.minutes >= NOON_MINUTES;
}

/** 正午判定の結果。返信があれば通知なし。朝の送信に失敗していた日は専用の文面 */
export function noonOutcome(day: DayState): NoonOutcome {
  if (day.firstReplyAt !== null) return 'replied';
  if (day.morningFailed || day.morningSentAt === null) return 'morning_failed';
  return 'no_reply';
}

/** 正午より前の返信か（お礼を送るかどうか。§5.3, §5.4） */
export function isBeforeNoon(now: number): boolean {
  return toJst(now).minutes < NOON_MINUTES;
}

// ---- 返信の種類（§5.1） ----

export type ReplyMethod = 'voice' | 'button_ok' | 'button_unwell' | 'text' | 'sticker' | 'image';

export const POSTBACK_OK = 'action=ok';
export const POSTBACK_UNWELL = 'action=unwell';
export const POSTBACK_UNWELL_CANCEL = 'action=unwell_cancel';

/** LINE のイベントの必要部分だけ（本文は見ない） */
export type ReplyEventLike =
  | { type: 'message'; message: { type: string } }
  | { type: 'postback'; postback: { data: string } }
  | { type: string };

/** 有効な返信なら記録する返信方法を返す。無効（動画・位置情報・ファイルなど）なら null */
export function classifyReply(event: ReplyEventLike): ReplyMethod | null {
  if (event.type === 'message' && 'message' in event) {
    switch (event.message.type) {
      case 'audio':
        return 'voice';
      case 'text':
        return 'text';
      case 'sticker':
        return 'sticker';
      case 'image':
        return 'image'; // 写真もお返事に数える（11/5 の仕様変更）
      default:
        return null;
    }
  }
  if (event.type === 'postback' && 'postback' in event) {
    if (event.postback.data === POSTBACK_OK) return 'button_ok';
    if (event.postback.data === POSTBACK_UNWELL) return 'button_unwell';
  }
  return null;
}

// ---- 不調ボタン（§6） ----

/** 不調通知を家族へ送るか：前回の通知から30分以内なら送らない */
export function shouldNotifyUnwell(lastNotifiedAt: number | null, now: number): boolean {
  return lastNotifiedAt === null || now - lastNotifiedAt >= UNWELL_DEBOUNCE_MS;
}

/** 押し間違いを取り消せるか：通知した日の23:59まで、まだ取り消していなければ */
export function canCancelUnwell(
  notifiedAt: number | null,
  cancelledAt: number | null,
  now: number,
): boolean {
  if (notifiedAt === null) return false;
  if (cancelledAt !== null && cancelledAt >= notifiedAt) return false;
  return toJst(notifiedAt).date === toJst(now).date;
}
