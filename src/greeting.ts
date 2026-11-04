// 挨拶文の文面チェックと予備挨拶文（仕様書 §3.2, §3.3, §4.2）

import fallbackGreetings from '../data/fallback-greetings.json';

export const GREETING_MAX_LENGTH = 50;

const FORBIDDEN_WORDS = ['死', '病気', '事故', '地震', '災害', '薬', '危険', '不安', '亡'];

/** 文面チェック。合格なら null、不合格なら理由を返す */
export function greetingProblem(text: string): string | null {
  if (!text.startsWith('おはよう。')) return '「おはよう。」で始まっていない';
  if ([...text].length > GREETING_MAX_LENGTH) return `${GREETING_MAX_LENGTH}文字を超えている`;
  if (/[\r\n]/.test(text)) return '改行を含む';
  if (/https?:|www\./i.test(text)) return 'URLを含む';
  if (/\p{Extended_Pictographic}/u.test(text)) return '絵文字を含む';
  if (/[!-\/:-@\[-`{-~]/.test(text)) return '半角記号を含む';
  const word = FORBIDDEN_WORDS.find((w) => text.includes(w));
  if (word) return `禁止語「${word}」を含む`;
  return null;
}

export function isValidGreeting(text: string): boolean {
  return greetingProblem(text) === null;
}

/** 予備挨拶文が見つからない日の最後の手段（月ごと） */
const MONTHLY_DEFAULT: Record<string, string> = {
  '01': 'おはよう。寒い日が続きますね。',
  '02': 'おはよう。春が待ち遠しい季節ですね。',
  '03': 'おはよう。少しずつ暖かくなってきましたね。',
  '04': 'おはよう。花がきれいな季節になりましたね。',
  '05': 'おはよう。新緑がまぶしい季節ですね。',
  '06': 'おはよう。あじさいがきれいな季節ですね。',
  '07': 'おはよう。夏らしくなってきましたね。',
  '08': 'おはよう。夏の空がまぶしい季節ですね。',
  '09': 'おはよう。秋の気配を感じる季節ですね。',
  '10': 'おはよう。秋が深まってきましたね。',
  '11': 'おはよう。紅葉がきれいな季節になりましたね。',
  '12': 'おはよう。今年も残りわずかになりましたね。',
};

/** その日（日本時間 'YYYY-MM-DD'）の予備挨拶文 */
export function fallbackGreeting(date: string): string {
  const mmdd = date.slice(5);
  const table = fallbackGreetings as Record<string, string>;
  const candidate = table[mmdd];
  if (candidate && isValidGreeting(candidate)) return candidate;
  return MONTHLY_DEFAULT[date.slice(5, 7)] ?? 'おはよう。今日もよい朝ですね。';
}

/** 共通の配信先（§3.2）から取得。失敗・不合格なら null（呼び出し側で予備に切り替える） */
export async function fetchGreetingFromApi(
  baseUrl: string,
  date: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (!baseUrl) return null;
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/greeting/${date}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { date?: unknown; greeting?: unknown };
    if (body.date !== date || typeof body.greeting !== 'string') return null;
    return isValidGreeting(body.greeting) ? body.greeting : null;
  } catch {
    return null;
  }
}
