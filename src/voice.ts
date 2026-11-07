// 親の声の返事を、管理者が聞けるようにする（11/7 の仕様変更）
// LINE や D1 には触れない関数だけを置く（署名には Web Crypto を使う）。
//
// 録音は自分の Worker の URL から LINE に渡す。LINE が取りに来るため URL は公開されるが、
// チャネルシークレットで作った署名と期限を付け、推測や使い回しができないようにする。

import { formatJstClock, MINUTE_MS, toJst } from './time';

/** 保存する録音の大きさの上限（D1 の1行の上限 2MB より小さく） */
export const VOICE_MAX_BYTES = 1_500_000;
/** 「こえ」で返す録音の数（返事は1回5通まで。1通目は一覧の文字） */
export const VOICE_LIST_MAX = 4;
/** 「こえ」で返す範囲（録音を残す日数と同じ） */
export const VOICE_RETENTION_DAYS = 7;
/**
 * URL の有効期限。LINE は録音を再生するときに取りに来ることがあるため、
 * 録音が残っているあいだ（最長7日）は有効にする。録音が消えれば URL も使えなくなる。
 */
export const VOICE_URL_TTL_MS = VOICE_RETENTION_DAYS * 24 * 60 * MINUTE_MS;

async function hmac(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 署名する中身。Webhook の署名と取り違えないよう、先頭に用途を付ける */
const payload = (id: number, expiresAt: number) => `voice-clip:${id}:${expiresAt}`;

/** 録音を渡す URL（origin は https://<name>.<サブドメイン>.workers.dev） */
export async function voiceUrl(secret: string, origin: string, id: number, now: number): Promise<string> {
  const e = now + VOICE_URL_TTL_MS;
  return `${origin}/voice/${id}?e=${e}&s=${await hmac(secret, payload(id, e))}`;
}

/** /voice/<id>?e=..&s=.. を確かめ、正しければ録音の id を返す。それ以外は null */
export async function verifyVoiceRequest(secret: string, url: URL, now: number): Promise<number | null> {
  const m = /^\/voice\/([1-9]\d{0,15})$/.exec(url.pathname);
  const e = Number(url.searchParams.get('e'));
  const s = url.searchParams.get('s') ?? '';
  if (!m || !secret || !Number.isSafeInteger(e) || e < now || e > now + VOICE_URL_TTL_MS + MINUTE_MS) return null;
  const id = Number(m[1]);
  const expected = await hmac(secret, payload(id, e));
  if (expected.length !== s.length) return null;
  let diff = 0;
  for (let i = 0; i < s.length; i++) diff |= expected.charCodeAt(i) ^ s.charCodeAt(i);
  return diff === 0 ? id : null;
}

export interface VoiceClipInfo {
  name: string;
  receivedAt: number;
  durationMs: number;
}

/** 「こえ」の1通目。下に続く録音の順番どおりに並べる（新しい順） */
export function voiceListText(clips: VoiceClipInfo[], today: string): string {
  if (clips.length === 0) return `この${VOICE_RETENTION_DAYS}日間の声のお返事はありません。`;
  const lines = clips.map((c, i) => {
    const jst = toJst(c.receivedAt);
    const date = jst.date === today ? '今日' : `${Number(jst.date.slice(5, 7))}/${Number(jst.date.slice(8, 10))}`;
    const sec = Math.max(1, Math.round(c.durationMs / 1000));
    return `${i + 1}. ${c.name} ${date} ${formatJstClock(c.receivedAt)}（${sec}秒）`;
  });
  return ['最近の声のお返事です（新しい順）。下の▶を押すと聞けます。', '', ...lines, '', `録音は${VOICE_RETENTION_DAYS}日で自動的に消えます。`].join('\n');
}

/** LINE の音声メッセージ */
export function audioMessage(url: string, durationMs: number): Record<string, unknown> {
  return { type: 'audio', originalContentUrl: url, duration: Math.max(1, Math.round(durationMs)) };
}
