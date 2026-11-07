// LINE Messaging API の送信（仕様書 §11, §12）
// - 応答メッセージ（reply）：送信数に数えない。返信用トークンは1回限り・短時間で無効
// - プッシュメッセージ（push）：送信先の人数×回数で数える
// - 重要な通知は1回だけ再試行。同じ再試行キー（X-Line-Retry-Key）で二重配信を防ぐ

import { parseConsumption, parseQuota } from '../quota';

const API = 'https://api.line.me/v2/bot';

export type LineMessage = Record<string, unknown>;

export interface PushResult {
  ok: boolean;
  status: number;
  /** 月間の送信上限に達した（再試行しない） */
  quotaExceeded: boolean;
  /** 1回やり直したか（§12.2） */
  retried?: boolean;
  error?: string;
}

export interface LineClient {
  reply(replyToken: string, messages: LineMessage[]): Promise<boolean>;
  push(to: string, messages: LineMessage[], retryKey: string): Promise<PushResult>;
  /** 今月の上限と消費数（§11.2）。取得できなかった値は null */
  getUsage(): Promise<{ quota: number | null; used: number | null }>;
  /** LINE の表示名（「メンバー」の一覧用。保存はしない）。取れなければ null */
  getDisplayName(userId: string): Promise<string | null>;
  /** 受け取ったメッセージの中身（声の録音など）。取れなければ null */
  getContent(messageId: string, maxBytes: number): Promise<{ data: ArrayBuffer; contentType: string } | null>;
}

export function createLineClient(accessToken: string, fetchImpl: typeof fetch = fetch): LineClient {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
  };

  return {
    async reply(replyToken, messages) {
      const res = await fetchImpl(`${API}/message/reply`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ replyToken, messages }),
      });
      if (!res.ok) {
        // 返信の失敗理由を記録する（本文は LINE からのエラー説明だけで、利用者のメッセージは含まない）
        console.error('LINE への応答メッセージに失敗', res.status, (await res.text()).slice(0, 300));
      }
      return res.ok;
    },

    async push(to, messages, retryKey) {
      const send = async (): Promise<PushResult> => {
        try {
          const res = await fetchImpl(`${API}/message/push`, {
            method: 'POST',
            headers: { ...headers, 'X-Line-Retry-Key': retryKey },
            body: JSON.stringify({ to, messages }),
          });
          // 409 = 同じ再試行キーで受け付け済み → 成功として扱う（§12.2）
          if (res.ok || res.status === 409) return { ok: true, status: res.status, quotaExceeded: false };
          const text = await res.text();
          const quotaExceeded = res.status === 429 && /monthly limit/i.test(text);
          return { ok: false, status: res.status, quotaExceeded, error: text.slice(0, 300) };
        } catch (e) {
          return { ok: false, status: 0, quotaExceeded: false, error: String(e).slice(0, 300) };
        }
      };

      const first = await send();
      if (first.ok || first.quotaExceeded) return first;
      // 400番台（宛先の間違いなど）は再試行しても直らないが、通信エラーと5xx・429は1回だけやり直す
      if (first.status >= 400 && first.status < 500 && first.status !== 429) return first;
      return { ...(await send()), retried: true };
    },

    async getContent(messageId, maxBytes) {
      try {
        const res = await fetchImpl(`https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`, {
          headers: { Authorization: headers.Authorization },
        });
        // 200 以外（準備中の 202 や、期限切れの 404 など）は保存しない
        if (res.status !== 200) return null;
        const data = await res.arrayBuffer();
        if (data.byteLength === 0 || data.byteLength > maxBytes) return null;
        return { data, contentType: res.headers.get('content-type') ?? 'audio/m4a' };
      } catch {
        return null;
      }
    },

    async getDisplayName(userId) {
      try {
        const res = await fetchImpl(`${API}/profile/${encodeURIComponent(userId)}`, { headers: { Authorization: headers.Authorization } });
        if (!res.ok) return null;
        const body = (await res.json()) as { displayName?: unknown };
        return typeof body.displayName === 'string' ? body.displayName : null;
      } catch {
        return null;
      }
    },

    async getUsage() {
      const get = async (path: string): Promise<unknown> => {
        try {
          const res = await fetchImpl(`${API}${path}`, { headers: { Authorization: headers.Authorization } });
          if (!res.ok) {
            console.error('LINE の送信数の取得に失敗', path, res.status);
            return null;
          }
          return await res.json();
        } catch (e) {
          console.error('LINE の送信数の取得に失敗', path, String(e));
          return null;
        }
      };
      const [quota, used] = await Promise.all([get('/message/quota'), get('/message/quota/consumption')]);
      return { quota: parseQuota(quota), used: parseConsumption(used) };
    },
  };
}
