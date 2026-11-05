// 招待コード（仕様書 §9.3）
// 英大文字と数字の8文字。読み間違えやすい O / 0 / I / 1 は使わない。
// D1 にはコードそのものではなくハッシュ値を保存する。

import { MINUTE_MS } from './time';

/** 32文字。256 を割り切れるので、乱数の偏りが出ない */
export const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const INVITE_LENGTH = 8;
export const INVITE_TTL_MS = 24 * 60 * MINUTE_MS;
export const INVITE_ATTEMPT_LIMIT = 5;
export const INVITE_ATTEMPT_WINDOW_MS = 60 * MINUTE_MS;

export function generateInviteCode(random: (n: number) => Uint8Array = randomBytes): string {
  const bytes = random(INVITE_LENGTH);
  let code = '';
  for (const b of bytes) code += INVITE_ALPHABET[b % INVITE_ALPHABET.length];
  return code;
}

function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** 入力の揺れをそろえる：前後の空白・全角英数字・小文字 */
export function normalizeInviteInput(text: string): string {
  return text.normalize('NFKC').trim().toUpperCase();
}

const INVITE_PATTERN = new RegExp(`^[${INVITE_ALPHABET}]{${INVITE_LENGTH}}$`);

export function looksLikeInviteCode(text: string): boolean {
  return INVITE_PATTERN.test(normalizeInviteInput(text));
}

export async function hashInviteCode(code: string): Promise<string> {
  const data = new TextEncoder().encode(normalizeInviteInput(code));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface InviteRecord {
  expiresAt: number;
  usedAt: number | null;
}

/** 使える招待コードか：期限内で、まだ使われていない */
export function isInviteUsable(invite: InviteRecord, now: number): boolean {
  return invite.usedAt === null && now < invite.expiresAt;
}

/** 登録前の人が、もう1回コードを試してよいか（1時間に5回まで） */
export function canAttemptInvite(recentAttemptTimes: number[], now: number): boolean {
  const recent = recentAttemptTimes.filter((t) => now - t < INVITE_ATTEMPT_WINDOW_MS);
  return recent.length < INVITE_ATTEMPT_LIMIT;
}

const CODE_IN_TEXT = new RegExp(`(?<![A-Za-z0-9])[${INVITE_ALPHABET}]{${INVITE_LENGTH}}(?![A-Za-z0-9])`, 'g');

/**
 * 送られた文章から、招待コードの候補を取り出す（最大3つ）。
 * 招待のメッセージを丸ごとコピーして貼り付けたり、登録用リンクの文章を送ったりしても登録できるように。
 * コードだけが送られたときは、小文字・全角でも受け付ける。
 */
export function extractInviteCodes(text: string): string[] {
  if (looksLikeInviteCode(text)) return [normalizeInviteInput(text)];
  const found = text.normalize('NFKC').match(CODE_IN_TEXT) ?? [];
  return [...new Set(found)].slice(0, 3);
}
