// 送信数の管理と日次メンテナンスの判定（仕様書 §11, §13.3）
// LINE や D1 には触れない純粋な関数だけを置く。

import { addDays, MINUTE_MS } from './time';

/** これを超えたらリマインドと「入力がありました」を止める（§11.4） */
export const REMINDER_STOP_THRESHOLD = 150;

const DAY_MS = 24 * 60 * MINUTE_MS;

/** 判定に使う今月の送信数：自分で数えた値と LINE から取得した値の大きい方（§11.2） */
export function effectivePushCount(ownCount: number, lineCount: number | null): number {
  return Math.max(ownCount, lineCount ?? 0);
}

export function isOverStopThreshold(count: number): boolean {
  return count > REMINDER_STOP_THRESHOLD;
}

/** LINE の「今月の上限」API の応答。上限なしなら null */
export function parseQuota(json: unknown): number | null {
  const j = json as { type?: string; value?: unknown };
  return j?.type === 'limited' && typeof j.value === 'number' ? j.value : null;
}

/** LINE の「今月の消費数」API の応答 */
export function parseConsumption(json: unknown): number | null {
  const v = (json as { totalUsage?: unknown })?.totalUsage;
  return typeof v === 'number' ? v : null;
}

/** 保存期間を過ぎたデータの境目（§13.3。入力の記録は 11/5 の仕様変更で7日） */
export interface RetentionCutoffs {
  /** daily_status：この日付より前を消す（90日） */
  dailyStatusBeforeDate: string;
  /** send_log：3か月（92日） */
  sendLogBefore: number;
  /** notification_failures：90日 */
  failuresBefore: number;
  /** processed_events・inputs・invite_attempts：7日 */
  weekBefore: number;
  /** invites：期限切れ・使用済みから7日 */
  invitesBefore: number;
  /** conversation_state：有効期限切れ */
  conversationBefore: number;
}

export function retentionCutoffs(now: number, today: string): RetentionCutoffs {
  return {
    dailyStatusBeforeDate: addDays(today, -90),
    sendLogBefore: now - 92 * DAY_MS,
    failuresBefore: now - 90 * DAY_MS,
    weekBefore: now - 7 * DAY_MS,
    invitesBefore: now - 7 * DAY_MS,
    conversationBefore: now,
  };
}
