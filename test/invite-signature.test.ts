import { describe, expect, it } from 'vitest';
import {
  canAttemptInvite,
  generateInviteCode,
  hashInviteCode,
  INVITE_TTL_MS,
  isInviteUsable,
  looksLikeInviteCode,
} from '../src/invite';
import { computeSignature, verifySignature } from '../src/line/signature';

describe('招待コード（§9.3）', () => {
  it('英大文字と数字の8文字で、O/0/I/1 を含まない', () => {
    for (let i = 0; i < 500; i++) {
      const code = generateInviteCode();
      expect(code).toMatch(/^[A-Z2-9]{8}$/);
      expect(code).not.toMatch(/[O0I1]/);
    }
  });
  it('形式の判定：全角・小文字・前後の空白は許す。O/0/I/1 や長さ違いは別物', () => {
    expect(looksLikeInviteCode('ABCD2345')).toBe(true);
    expect(looksLikeInviteCode(' abcd2345 ')).toBe(true);
    expect(looksLikeInviteCode('ＡＢＣＤ２３４５')).toBe(true);
    expect(looksLikeInviteCode('ABCD0123')).toBe(false);
    expect(looksLikeInviteCode('ABCD234')).toBe(false);
    expect(looksLikeInviteCode('ようす')).toBe(false);
  });
  it('ハッシュ値は入力の揺れをそろえてから計算する', async () => {
    expect(await hashInviteCode('abcd2345')).toBe(await hashInviteCode('ABCD2345'));
    expect(await hashInviteCode('ABCD2345')).not.toBe(await hashInviteCode('ABCD2346'));
  });
  it('有効期限は24時間、1回使うと無効', () => {
    const issued = 1_000_000;
    const invite = { expiresAt: issued + INVITE_TTL_MS, usedAt: null };
    expect(isInviteUsable(invite, issued + INVITE_TTL_MS - 1)).toBe(true);
    expect(isInviteUsable(invite, issued + INVITE_TTL_MS)).toBe(false);
    expect(isInviteUsable({ ...invite, usedAt: issued + 10 }, issued + 20)).toBe(false);
  });
  it('登録前の人のコード入力は1時間に5回まで', () => {
    const now = 10 * 60 * 60_000;
    const four = [1, 2, 3, 4].map((m) => now - m * 60_000);
    expect(canAttemptInvite(four, now)).toBe(true);
    expect(canAttemptInvite([...four, now - 5 * 60_000], now)).toBe(false);
    // 1時間より前の入力は数えない
    expect(canAttemptInvite([...four, now - 61 * 60_000], now)).toBe(true);
  });
});

describe('Webhook の署名検証（§13.5）', () => {
  const secret = 'test-channel-secret';
  const body = '{"events":[]}';
  it('正しい署名なら通す', async () => {
    const sig = await computeSignature(secret, body);
    expect(await verifySignature(secret, body, sig)).toBe(true);
  });
  it('本文が1文字でも違えば通さない', async () => {
    const sig = await computeSignature(secret, body);
    expect(await verifySignature(secret, body + ' ', sig)).toBe(false);
  });
  it('署名なし・シークレット違いは通さない', async () => {
    const sig = await computeSignature('other-secret', body);
    expect(await verifySignature(secret, body, sig)).toBe(false);
    expect(await verifySignature(secret, body, null)).toBe(false);
  });
});
