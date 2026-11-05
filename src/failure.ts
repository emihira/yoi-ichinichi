// 送信エラーへの対応（仕様書 §12）
// LINE や D1 に触れない「純粋な関数」だけを置く。

import type { PushResult } from './line/client';

/** 重要な通知（§12.1）。失敗したら管理者へ知らせる */
const IMPORTANT_KINDS = new Set(['morning', 'noon', 'unwell', 'unwell_cancel', 'blocked', 'unblocked']);

export function isImportantKind(kind: string): boolean {
  return IMPORTANT_KINDS.has(kind);
}

/** 失敗履歴の retry_result に残す言葉（§12.2） */
export function retryResultLabel(r: PushResult): string {
  if (r.quotaExceeded) return 'quota_exceeded'; // 送信数の上限：再試行しない
  return r.retried ? 'retried_failed' : 'not_retried';
}

export type AdminNoticePlan = 'send' | 'skip_admin_was_target' | 'skip_no_admin';

/**
 * 管理者へ知らせるか（§12.3）。
 * 届かなかった相手が管理者本人なら、同じ宛先へ送り直しても届かないので送らない
 */
export function adminNoticePlan(adminUserId: number | null, failedUserIds: number[]): AdminNoticePlan {
  if (adminUserId === null) return 'skip_no_admin';
  return failedUserIds.includes(adminUserId) ? 'skip_admin_was_target' : 'send';
}
