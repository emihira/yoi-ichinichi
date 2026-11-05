import { describe, expect, it } from 'vitest';
import { extractGreeting, generatedProblem, japaneseDate, solarTermNote, SYSTEM_PROMPT, userPrompt } from '../greeting-generator/src/prompt';

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
  it('節気の前後を正しく伝える（11/5 は立冬の前）', () => {
    expect(solarTermNote('2026-11-05')).toContain('まだ立冬にはなっていない');
    expect(solarTermNote('2026-11-07')).toContain('今は立冬（11月7日ごろ）のころ');
    expect(solarTermNote('2026-11-06')).toContain('もうすぐ立冬');
    expect(solarTermNote('2026-12-30')).toContain('冬至（12月22日ごろ）を過ぎて');
    expect(solarTermNote('2027-01-02')).toContain('次の小寒');
    expect(userPrompt('2026-11-05', [])).toContain('二十四節気：');
  });
  it('生成した挨拶文は、一文だけで、お願いや勧めをしない', () => {
    expect(generatedProblem('おはよう。菊の花がきれいな季節ですね。')).toBeNull();
    expect(generatedProblem('おはよう。朝晩の冷えが深まるころですね。あたたかくしてお過ごしくださいね。')).not.toBeNull();
    expect(generatedProblem('おはよう。温かいお茶を飲みましょうね。')).not.toBeNull();
  });
});
