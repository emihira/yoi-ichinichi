// よい一日のはじまりに：家族側 Worker の入り口
// - fetch：LINE からの Webhook を受け取る
// - scheduled：Cron Triggers（5分ごとの見守り処理と、毎日4:00の日次メンテナンス）

import { deleteInputsBefore } from './db';
import type { Env } from './env';
import { INPUT_RETENTION_DAYS } from './input';
import { verifySignature } from './line/signature';
import { runWatch, depsFromEnv } from './watch';
import { handleEvents, type LineEvent } from './webhook';

const CRON_WATCH = '*/5 20-23,0-3 * * *';
const CRON_MAINTENANCE = '0 19 * * *';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/webhook') {
      return new Response('よい一日のはじまりに', { status: 200 });
    }

    // 署名は「受け取った本文そのもの」で確かめる（§13.5）
    const raw = await request.text();
    const ok = await verifySignature(env.LINE_CHANNEL_SECRET, raw, request.headers.get('x-line-signature'));
    if (!ok) return new Response('invalid signature', { status: 401 });

    let events: LineEvent[] = [];
    try {
      events = (JSON.parse(raw) as { events?: LineEvent[] }).events ?? [];
    } catch {
      return new Response('bad request', { status: 400 });
    }

    // LINE にはすぐ 200 を返し、処理は裏で続ける（§13.5）
    ctx.waitUntil(handleEvents(env, events));
    return new Response('ok', { status: 200 });
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron === CRON_WATCH) {
      ctx.waitUntil(runWatch(depsFromEnv(env)));
    } else if (event.cron === CRON_MAINTENANCE) {
      // 親からの入力の記録は7日間だけ残す（11/5 の仕様変更）
      ctx.waitUntil(deleteInputsBefore(env.DB, Date.now() - INPUT_RETENTION_DAYS * 24 * 60 * 60_000).then(() => undefined));
      // TODO ⑪：送信数の照合（LINEの送信数確認API）・ほかの古いデータの削除・送信時刻の切り替え
    }
  },
} satisfies ExportedHandler<Env>;
