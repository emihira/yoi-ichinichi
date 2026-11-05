import { describe, expect, it } from 'vitest';
import { describeInput, formatInputLine, INPUT_TEXT_MAX, isInputNoticeTarget } from '../src/input';
import { formatParentStatus } from '../src/status';
import { jst } from './helpers';

describe('親からの入力の記録（11/5 の仕様変更）', () => {
  it('文字は本文、声は秒数、スタンプ・写真は種類だけを記録する', () => {
    expect(describeInput({ type: 'message', message: { type: 'text', text: 'おはよう' } })).toEqual({
      kind: 'text',
      detail: 'おはよう',
    });
    expect(describeInput({ type: 'message', message: { type: 'audio', duration: 12_400 } })).toEqual({
      kind: 'voice',
      detail: '12',
    });
    expect(describeInput({ type: 'message', message: { type: 'sticker' } })).toEqual({ kind: 'sticker', detail: null });
    expect(describeInput({ type: 'message', message: { type: 'image' } })).toEqual({ kind: 'image', detail: null });
  });
  it('ボタンは［げんきです］［ぐあいがわるい］だけ。友だち追加などは記録しない', () => {
    expect(describeInput({ type: 'postback', postback: { data: 'action=ok' } })?.kind).toBe('button_ok');
    expect(describeInput({ type: 'postback', postback: { data: 'action=unwell' } })?.kind).toBe('button_unwell');
    expect(describeInput({ type: 'postback', postback: { data: 'action=unwell_cancel' } })).toBeNull();
    expect(describeInput({ type: 'follow' })).toBeNull();
  });
  it('長い文字は300文字までにする', () => {
    const r = describeInput({ type: 'message', message: { type: 'text', text: 'あ'.repeat(400) } });
    expect([...(r?.detail ?? '')].length).toBe(INPUT_TEXT_MAX);
  });
  it('［ぐあいがわるい］は専用の通知があるので「入力がありました」は送らない', () => {
    expect(isInputNoticeTarget('voice')).toBe(true);
    expect(isInputNoticeTarget('image')).toBe(true);
    expect(isInputNoticeTarget('button_unwell')).toBe(false);
  });
  it('「ようす」の1行：今日は時刻だけ、それ以外は日付も付ける', () => {
    const today = '2026-11-05';
    expect(formatInputLine('voice', '12', jst(today, '08:01'), today)).toBe('8:01 声（12秒）');
    expect(formatInputLine('text', 'げんきよ', jst('2026-11-04', '18:30'), today)).toBe('11/4 18:30 文字「げんきよ」');
    expect(formatInputLine('sticker', null, jst(today, '09:00'), today)).toBe('9:00 スタンプ');
  });
  it('「ようす」に最近の入力が並ぶ', () => {
    const today = '2026-11-05';
    const parent = { sendTime: '08:00', status: 'active' as const, pauseUntil: null, registeredDate: '2026-10-01' };
    const out = formatParentStatus('母', parent, today, [], [
      { kind: 'text', detail: 'ありがとう', receivedAt: jst(today, '08:05') },
      { kind: 'voice', detail: '7', receivedAt: jst(today, '08:01') },
    ]);
    expect(out).toContain('最近の入力：\n・8:05 文字「ありがとう」\n・8:01 声（7秒）');
  });
});
