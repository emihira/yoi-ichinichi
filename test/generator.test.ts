import { describe, expect, it } from 'vitest';
import { extractGreeting, japaneseDate, SYSTEM_PROMPT, userPrompt } from '../greeting-generator/src/prompt';

describe('挨拶文の生成（§3.2）', () => {
  it('日付を日本語にする', () => {
    expect(japaneseDate('2026-11-06')).toBe('11月6日');
    expect(japaneseDate('2027-01-01')).toBe('1月1日');
  });
  it('指示文に §4.2 の主な条件が入っている', () => {
    for (const w of ['おはよう。', '50文字以内', '外来語', '言い切らない', '健康や医療', '絵文字']) {
      expect(SYSTEM_PROMPT).toContain(w);
    }
  });
  it('最近の挨拶文を伝えて、同じ話題を避ける', () => {
    const p = userPrompt('2026-11-06', ['おはよう。温かいお茶がおいしい季節ですね。']);
    expect(p).toContain('11月6日');
    expect(p).toContain('- おはよう。温かいお茶がおいしい季節ですね。');
    expect(userPrompt('2026-11-06', [])).not.toContain('最近の挨拶文');
  });
  it('応答の前後の空白やかぎかっこを取る', () => {
    expect(extractGreeting('  「おはよう。菊の花がきれいな季節ですね。」\n')).toBe('おはよう。菊の花がきれいな季節ですね。');
    expect(extractGreeting('おはよう。立冬のころですね。')).toBe('おはよう。立冬のころですね。');
  });
});
