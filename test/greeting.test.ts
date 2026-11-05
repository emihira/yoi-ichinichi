import { describe, expect, it } from 'vitest';
import fallbackGreetings from '../data/fallback-greetings.json';
import { fallbackGreeting, fetchGreetingFromApi, greetingProblem, isValidGreeting } from '../src/greeting';

describe('文面チェック（§4.2）', () => {
  it('条件を満たす挨拶文は合格', () => {
    expect(greetingProblem('おはよう。紅葉がきれいな季節になりましたね。')).toBeNull();
  });
  it('「おはよう。」で始まらないと不合格', () => {
    expect(isValidGreeting('こんにちは。いい天気ですね。')).toBe(false);
  });
  it('50文字を超えると不合格（50文字ちょうどは合格）', () => {
    const fifty = 'おはよう。' + 'あ'.repeat(45);
    expect([...fifty].length).toBe(50);
    expect(isValidGreeting(fifty)).toBe(true);
    expect(isValidGreeting(fifty + 'あ')).toBe(false);
  });
  it('改行・URL・絵文字・半角記号を含むと不合格', () => {
    expect(isValidGreeting('おはよう。\n寒いですね。')).toBe(false);
    expect(isValidGreeting('おはよう。https://example.com')).toBe(false);
    expect(isValidGreeting('おはよう。寒いですね😊')).toBe(false);
    expect(isValidGreeting('おはよう。寒いですね!')).toBe(false);
  });
  it('禁止語を含むと不合格', () => {
    for (const w of ['死', '病気', '事故', '地震', '災害', '薬']) {
      expect(isValidGreeting(`おはよう。${w}に気をつけましょう。`)).toBe(false);
    }
  });
});

describe('予備挨拶文（§3.3）', () => {
  it('収録されている予備挨拶文は、すべて文面チェックに合格する', () => {
    for (const [key, g] of Object.entries(fallbackGreetings as Record<string, string>)) {
      expect(greetingProblem(g), `${key}: ${g}`).toBeNull();
    }
  });
  it('366日分（2月29日を含む）がそろっていて、同じ文がない', () => {
    const all = fallbackGreetings as Record<string, string>;
    const keys = Object.keys(all);
    expect(keys.length).toBe(366);
    expect(keys).toContain('02-29');
    for (let d = new Date(Date.UTC(2028, 0, 1)); d.getUTCFullYear() === 2028; d.setUTCDate(d.getUTCDate() + 1)) {
      expect(all[d.toISOString().slice(5, 10)]).toBeDefined();
    }
    expect(new Set(Object.values(all)).size).toBe(366);
  });
  it('毎年日付が変わる行事（節気など）で「今日は」と言い切らない', () => {
    for (const [key, g] of Object.entries(fallbackGreetings as Record<string, string>)) {
      expect(/今日は.*(立春|立夏|立秋|立冬|春分|秋分|夏至|冬至|大寒|小寒|節分|土用)/.test(g), `${key}: ${g}`).toBe(false);
    }
  });
  it('その日の予備挨拶文がなければ、月ごとの挨拶文を使う', () => {
    expect(fallbackGreeting('2026-11-05')).toBe((fallbackGreetings as Record<string, string>)['11-05']);
    expect(isValidGreeting(fallbackGreeting('2027-03-20'))).toBe(true);
  });
});

describe('共通配信先からの取得（§3.2）', () => {
  const ok = (body: unknown, status = 200) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it('日付が一致し、文面チェックに合格すれば使う', async () => {
    const g = 'おはよう。立冬が近づいてきましたね。';
    expect(await fetchGreetingFromApi('https://x', '2026-11-05', ok({ date: '2026-11-05', greeting: g }))).toBe(g);
  });
  it('404・日付違い・不合格・通信エラー・配信先なしでは null（予備に切り替える）', async () => {
    expect(await fetchGreetingFromApi('https://x', '2026-11-05', ok({}, 404))).toBeNull();
    expect(
      await fetchGreetingFromApi('https://x', '2026-11-05', ok({ date: '2026-11-04', greeting: 'おはよう。寒いですね。' })),
    ).toBeNull();
    expect(await fetchGreetingFromApi('https://x', '2026-11-05', ok({ date: '2026-11-05', greeting: '地震' }))).toBeNull();
    const broken = (async () => {
      throw new Error('network');
    }) as unknown as typeof fetch;
    expect(await fetchGreetingFromApi('https://x', '2026-11-05', broken)).toBeNull();
    expect(await fetchGreetingFromApi('', '2026-11-05', ok({}))).toBeNull();
  });
});
