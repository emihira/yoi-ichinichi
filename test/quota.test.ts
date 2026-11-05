import { describe, expect, it } from 'vitest';
import {
  effectivePushCount,
  isOverStopThreshold,
  parseConsumption,
  parseQuota,
  retentionCutoffs,
} from '../src/quota';
import { jst } from './helpers';

describe('送信数の管理（§11）', () => {
  it('判定には、自分で数えた値と LINE の値の大きい方を使う', () => {
    expect(effectivePushCount(40, 52)).toBe(52);
    expect(effectivePushCount(60, 52)).toBe(60);
    expect(effectivePushCount(40, null)).toBe(40); // LINE から取れなかったときは自分の値
  });
  it('150通を「超えたら」止める（150通ちょうどはまだ止めない）', () => {
    expect(isOverStopThreshold(150)).toBe(false);
    expect(isOverStopThreshold(151)).toBe(true);
  });
  it('LINE の応答を読み取る', () => {
    expect(parseQuota({ type: 'limited', value: 200 })).toBe(200);
    expect(parseQuota({ type: 'none' })).toBeNull();
    expect(parseQuota(null)).toBeNull();
    expect(parseConsumption({ totalUsage: 37 })).toBe(37);
    expect(parseConsumption({})).toBeNull();
  });
});

describe('保存期間（§13.3）', () => {
  it('daily_status は90日、send_log は3か月、失敗履歴は90日、入力などは7日', () => {
    const now = jst('2026-11-05', '04:00');
    const c = retentionCutoffs(now, '2026-11-05');
    expect(c.dailyStatusBeforeDate).toBe('2026-08-07');
    expect(now - c.sendLogBefore).toBe(92 * 86_400_000);
    expect(now - c.failuresBefore).toBe(90 * 86_400_000);
    expect(now - c.weekBefore).toBe(7 * 86_400_000);
    expect(c.conversationBefore).toBe(now);
  });
});
