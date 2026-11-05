// 挨拶文を作るための指示文と、結果の取り出し（純粋な関数。テストで確かめる）

/** 'YYYY-MM-DD' → '11月6日' */
export function japaneseDate(date: string): string {
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
}

/**
 * 二十四節気のおおよその日付（年によって前後1日ずれる）。
 * Claude が節気の前後を取り違えないよう、その日に近い節気を正しく伝えるために使う。
 */
const SOLAR_TERMS: [string, number, number][] = [
  ['小寒', 1, 5], ['大寒', 1, 20], ['立春', 2, 4], ['雨水', 2, 19], ['啓蟄', 3, 5], ['春分', 3, 20],
  ['清明', 4, 4], ['穀雨', 4, 20], ['立夏', 5, 5], ['小満', 5, 21], ['芒種', 6, 5], ['夏至', 6, 21],
  ['小暑', 7, 7], ['大暑', 7, 22], ['立秋', 8, 7], ['処暑', 8, 23], ['白露', 9, 7], ['秋分', 9, 23],
  ['寒露', 10, 8], ['霜降', 10, 23], ['立冬', 11, 7], ['小雪', 11, 22], ['大雪', 12, 7], ['冬至', 12, 22],
];

const DAY_MS = 86_400_000;

/** その日と節気の関係を、言い切りすぎない言葉で返す。例：「立冬（11月7日ごろ）の2日前。まだ立冬を過ぎていない」 */
export function solarTermNote(date: string): string {
  const y = Number(date.slice(0, 4));
  const today = Date.UTC(y, Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  const terms = [y - 1, y, y + 1].flatMap((yy) => SOLAR_TERMS.map(([n, m, d]) => ({ n, m, d, t: Date.UTC(yy, m - 1, d) })));
  const prev = terms.filter((x) => x.t <= today).at(-1)!;
  const next = terms.find((x) => x.t > today)!;
  const diffPrev = Math.round((today - prev.t) / DAY_MS);
  const diffNext = Math.round((next.t - today) / DAY_MS);
  const label = (x: { n: string; m: number; d: number }) => `${x.n}（${x.m}月${x.d}日ごろ）`;
  if (diffPrev <= 1) return `今は${label(prev)}のころ。次は${label(next)}`;
  if (diffNext <= 1) return `もうすぐ${label(next)}。今は${label(prev)}を過ぎたころ`;
  return `今は${label(prev)}を過ぎて${diffPrev}日ほど。次の${label(next)}まで${diffNext}日ほどで、まだ${next.n}にはなっていない`;
}

/** 毎日変わらない部分（§4.2 の生成時の指示） */
export const SYSTEM_PROMPT = `あなたは、離れて暮らす高齢の親に毎朝LINEで届ける、短い朝の挨拶文を書きます。

条件：
- 「おはよう。」で始め、そのあとに季節感のある短いひと言を続ける
- ひと言は、親しみのある丁寧語（「〜ですね」「〜ましたね」など）
- 全体で40文字程度、長くても50文字以内。改行しない
- 季節・二十四節気・季節の行事・旬の食べ物・草花などを取り入れる
- 高齢の方が読みやすい言葉にする。難しい漢字、カタカナの外来語、英数字、記号は使わない
- 天気や気温、地域の出来事など、確かめていない事実を言い切らない（「今日は晴れ」などは書かない）
- 節気は、下に伝える「二十四節気」の情報と食い違わないようにする。まだ来ていない節気を「過ぎ」と書かない
- 節気や行事は、年によって日付が変わるものを「今日は〜」と言い切らず「〜のころ」とする
- 「おはよう。」のあとは一文だけにする
- 相手に何かを勧めたりお願いしたりしない（「〜してください」「〜しましょう」「お過ごしください」などは書かない）
- 健康や医療についての助言、不安をあおる表現、命令口調、絵文字は使わない
- 「死」「病気」「事故」「地震」「災害」「薬」「危険」「不安」「亡」の字や言葉は使わない

挨拶文だけを1行で答えてください。説明や前置きは書かないでください。`;

/** 日ごとに変わる部分。最近の挨拶文と同じにならないよう、それも伝える */
export function userPrompt(date: string, recent: string[]): string {
  const lines = [`${japaneseDate(date)}の朝の挨拶文を1つ書いてください。`, `二十四節気：${solarTermNote(date)}`];
  if (recent.length > 0) {
    lines.push('', '最近の挨拶文（これらとは違う話題にしてください）：', ...recent.map((g) => `- ${g}`));
  }
  return lines.join('\n');
}

/**
 * 生成した挨拶文だけに行う、追加のチェック（家族側の文面チェック §4.2 に加えて）。
 * 「おはよう。」のあとが一文であること、相手にお願いや勧めをしないこと。合格なら null
 */
export function generatedProblem(greeting: string): string | null {
  const sentences = greeting.split('。').filter((x) => x.length > 0);
  if (sentences.length !== 2) return '「おはよう。」のあとが一文ではない';
  if (/ください|しましょう|ましょう|なさい/.test(greeting)) return 'お願いや勧めの言葉を含む';
  return null;
}

/** 応答の文字から挨拶文を取り出す：前後の空白と、全体を囲むかぎかっこ・引用符を取る */
export function extractGreeting(text: string): string {
  return text
    .trim()
    .replace(/^[「『"]+|[」』"]+$/g, '')
    .trim();
}
