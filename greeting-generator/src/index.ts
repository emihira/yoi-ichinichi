// 共通の挨拶文生成システム（仕様書 §3.2）
// - scheduled：日本時間 3:00 に生成、4:00 は 3:00 の分が無いときだけ作り直す
// - fetch：GET /greeting/YYYY-MM-DD で、その日の挨拶文を JSON で返す（無ければ 404）。読み取り専用

import Anthropic from '@anthropic-ai/sdk';
import { greetingProblem } from '../../src/greeting';
import { addDays, toJst } from '../../src/time';
import { extractGreeting, generatedProblem, SYSTEM_PROMPT, userPrompt } from './prompt';

interface Env {
  GREETINGS: KVNamespace;
  ANTHROPIC_API_KEY: string;
}

interface StoredGreeting {
  date: string;
  greeting: string;
  generated_at: string;
  version: 1;
}

const MODEL = 'claude-haiku-5-5';
const KEEP_SECONDS = 60 * 60 * 24 * 30; // 30日で自動的に消える
const RECENT_DAYS = 7;

const key = (date: string) => `greeting:${date}`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/greeting\/(\d{4}-\d{2}-\d{2})$/);
    if (request.method !== 'GET' || !m) return new Response('not found', { status: 404 });
    const body = await env.GREETINGS.get(key(m[1]!));
    if (body === null) return new Response('not found', { status: 404 });
    return new Response(body, {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
    });
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(generateForToday(env, Date.now()));
  },
} satisfies ExportedHandler<Env>;

/** その日（日本時間）の挨拶文が無ければ作る。3:00 の分があれば 4:00 は何もしない */
async function generateForToday(env: Env, now: number): Promise<void> {
  const date = toJst(now).date;
  if ((await env.GREETINGS.get(key(date))) !== null) return;

  const recent: string[] = [];
  for (let i = 1; i <= RECENT_DAYS; i++) {
    const r = await env.GREETINGS.get<StoredGreeting>(key(addDays(date, -i)), 'json');
    if (r) recent.push(r.greeting);
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  // 1回の起動で2回まで試す。どちらも駄目なら 4:00 にもう一度（それも駄目なら家族側は予備挨拶文を使う）
  let greeting: string | null = null;
  for (let attempt = 1; attempt <= 2 && greeting === null; attempt++) {
    greeting = await generateOnce(client, date, recent);
  }
  if (greeting === null) return;

  const stored: StoredGreeting = { date, greeting, generated_at: new Date(now).toISOString(), version: 1 };
  await env.GREETINGS.put(key(date), JSON.stringify(stored), { expirationTtl: KEEP_SECONDS });
  console.log('挨拶文を保存しました', date);
}

/** Claude に1回頼む。文面チェックに合格した挨拶文、または null を返す */
async function generateOnce(client: Anthropic, date: string, recent: string[]): Promise<string | null> {
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      output_config: { effort: 'low' },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt(date, recent) }],
    });
    if (res.stop_reason === 'refusal') {
      console.error('挨拶文の生成が断られました', date);
      return null;
    }
    const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    const greeting = extractGreeting(text);
    const problem = greetingProblem(greeting) ?? generatedProblem(greeting);
    if (problem) {
      console.error('文面チェックで不合格', date, problem, greeting);
      return null;
    }
    return greeting;
  } catch (e) {
    if (e instanceof Anthropic.APIError) console.error('Claude API のエラー', e.status, e.message);
    else console.error('挨拶文の生成でエラー', String(e));
    return null;
  }
}
