import { describe, expect, it } from 'vitest';
import { addDays, formatClock, isValidSendTime, parseHHMM, toJst } from '../src/time';

describe('日本時間への変換（§3.4）', () => {
  it('UTC 23:00 は日本時間の翌日 8:00', () => {
    expect(toJst(new Date('2026-11-04T23:00:00Z'))).toEqual({ date: '2026-11-05', minutes: 8 * 60 });
  });

  it('日付が変わる前後：UTC 14:59 は日本時間 23:59、UTC 15:00 は翌日 0:00', () => {
    expect(toJst(new Date('2026-11-04T14:59:00Z'))).toEqual({ date: '2026-11-04', minutes: 23 * 60 + 59 });
    expect(toJst(new Date('2026-11-04T15:00:00Z'))).toEqual({ date: '2026-11-05', minutes: 0 });
  });

  it('月末・年末をまたぐ', () => {
    expect(toJst(new Date('2026-12-31T15:00:00Z')).date).toBe('2027-01-01');
    expect(toJst(new Date('2028-02-28T15:00:00Z')).date).toBe('2028-02-29');
  });

  it('Cron の範囲（UTC 20:00〜03:55）は日本時間 5:00〜12:55', () => {
    expect(toJst(new Date('2026-11-04T20:00:00Z'))).toEqual({ date: '2026-11-05', minutes: 5 * 60 });
    expect(toJst(new Date('2026-11-05T03:55:00Z'))).toEqual({ date: '2026-11-05', minutes: 12 * 60 + 55 });
  });

  it('時刻の読み書き', () => {
    expect(parseHHMM('08:15')).toBe(495);
    expect(formatClock(495)).toBe('8:15');
    expect(() => parseHHMM('8:15')).toThrow();
    expect(() => parseHHMM('25:00')).toThrow();
  });

  it('日付に日数を足す', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });
});

describe('送信時刻の範囲（§4.1）', () => {
  it('5:00〜10:00 の15分刻みだけ選べる', () => {
    expect(isValidSendTime('05:00')).toBe(true);
    expect(isValidSendTime('09:45')).toBe(true);
    expect(isValidSendTime('10:00')).toBe(true);
    expect(isValidSendTime('04:45')).toBe(false);
    expect(isValidSendTime('10:15')).toBe(false);
    expect(isValidSendTime('08:10')).toBe(false);
  });
});
