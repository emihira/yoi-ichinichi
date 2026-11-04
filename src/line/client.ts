// LINE Messaging API の送信（仕様書 §11, §12）
// - 応答メッセージ（reply）：送信数に数えない。返信用トークンは1回限り・短時間で無効
// - プッシュメッセージ（push）：送信先の人数×回数で数える
// - 重要な通知は1回だけ再試行。同じ再試行キー（X-Line-Retry-Key）で二重配信を防ぐ

const API = 'https://api.line.me/v2/bot';

export type LineMessage = Record<string, unknown>;

export interface PushResult {
  ok: boolean;
  status: number;
  /** 月間の送信上限に達した（再試行しない） */
  quotaExceeded: boolean;
  error?: string;
}

export interface LineClient {
  reply(replyToken: string, messages: LineMessage[]): Promise<boolean>;
  push(to: string, messages: LineMessage[], retryKey: string): Promise<PushResult>;
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
      return send();
    },
  };
}
