import { describe, expect, it } from 'vitest';
import { audioMessage, VOICE_URL_TTL_MS, verifyVoiceRequest, voiceListText, voiceUrl } from '../src/voice';
import { FAMILY_COMMANDS } from '../src/family';
import { usageText } from '../src/line/messages';
import { createLineClient } from '../src/line/client';
import { jst } from './helpers';

const SECRET = 'test-channel-secret';
const ORIGIN = 'https://yoi.example.workers.dev';
const NOW = jst('2026-11-07', '09:00');

describe('録音を渡す URL（署名と期限）', () => {
  it('作った URL は正しいと判定され、録音の番号を返す', async () => {
    const url = new URL(await voiceUrl(SECRET, ORIGIN, 12, NOW));
    expect(url.origin).toBe(ORIGIN);
    expect(await verifyVoiceRequest(SECRET, url, NOW + 60_000)).toBe(12);
  });
  it('番号を書き換えると使えない（ほかの録音を聞けない）', async () => {
    const url = new URL(await voiceUrl(SECRET, ORIGIN, 12, NOW));
    url.pathname = '/voice/13';
    expect(await verifyVoiceRequest(SECRET, url, NOW)).toBeNull();
  });
  it('期限を延ばすと使えない', async () => {
    const url = new URL(await voiceUrl(SECRET, ORIGIN, 12, NOW));
    url.searchParams.set('e', String(Number(url.searchParams.get('e')) + 1));
    expect(await verifyVoiceRequest(SECRET, url, NOW)).toBeNull();
  });
  it('期限を過ぎると使えない', async () => {
    const url = new URL(await voiceUrl(SECRET, ORIGIN, 12, NOW));
    expect(await verifyVoiceRequest(SECRET, url, NOW + VOICE_URL_TTL_MS)).toBe(12);
    expect(await verifyVoiceRequest(SECRET, url, NOW + VOICE_URL_TTL_MS + 1)).toBeNull();
  });
  it('別のシークレットで作った URL、署名のない URL は使えない', async () => {
    const other = new URL(await voiceUrl('another-secret', ORIGIN, 12, NOW));
    expect(await verifyVoiceRequest(SECRET, other, NOW)).toBeNull();
    expect(await verifyVoiceRequest(SECRET, new URL(`${ORIGIN}/voice/12`), NOW)).toBeNull();
    expect(await verifyVoiceRequest(SECRET, new URL(`${ORIGIN}/voice/abc?e=1&s=x`), NOW)).toBeNull();
  });
});

describe('「こえ」の返事', () => {
  it('新しい順に、名前・日時・長さを並べる。今日の分は「今日」', () => {
    const t = voiceListText(
      [
        { name: 'はなこさん', receivedAt: jst('2026-11-07', '07:33'), durationMs: 12_300 },
        { name: 'はなこさん', receivedAt: jst('2026-11-05', '08:01'), durationMs: 400 },
      ],
      '2026-11-07',
    );
    expect(t).toContain('1. はなこさん 今日 7:33（12秒）');
    expect(t).toContain('2. はなこさん 11/5 8:01（1秒）');
    expect(t).toContain('7日で自動的に消えます');
  });
  it('録音がなければ、そう伝える', () => {
    expect(voiceListText([], '2026-11-07')).toBe('この7日間の声のお返事はありません。');
  });
  it('LINE の音声メッセージの形', () => {
    expect(audioMessage('https://x/voice/1?e=1&s=a', 12_300)).toEqual({
      type: 'audio',
      originalContentUrl: 'https://x/voice/1?e=1&s=a',
      duration: 12300,
    });
  });
  it('管理者の「つかいかた」にだけ出る。呼び名の入力待ちでも操作として扱う', () => {
    expect((usageText(true) as { text: string }).text).toContain('こえ：');
    expect((usageText(false) as { text: string }).text).not.toContain('こえ');
    expect(FAMILY_COMMANDS).toContain('こえ');
  });
});

describe('録音の取り出し（LINE から）', () => {
  const client = (status: number, bytes: number) =>
    createLineClient('token', (async () =>
      new Response(status === 200 ? new Uint8Array(bytes) : null, {
        status,
        headers: { 'content-type': 'audio/m4a' },
      })) as unknown as typeof fetch);

  it('取り出せたら中身と種類を返す', async () => {
    const r = await client(200, 1000).getContent('m1', 1_500_000);
    expect(r?.data.byteLength).toBe(1000);
    expect(r?.contentType).toBe('audio/m4a');
  });
  it('準備中（202）・見つからない（404）・大きすぎる録音は保存しない', async () => {
    expect(await client(202, 0).getContent('m1', 1_500_000)).toBeNull();
    expect(await client(404, 0).getContent('m1', 1_500_000)).toBeNull();
    expect(await client(200, 2000).getContent('m1', 1000)).toBeNull();
  });
});
