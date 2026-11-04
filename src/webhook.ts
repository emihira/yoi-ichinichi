// LINE からのイベントの処理（仕様書 §5, §6, §9）

import {
  getUserByLineId,
  markEventProcessed,
  markThanksSent,
  recordFirstReply,
  registerAdmin,
  type UserRow,
} from './db';
import type { Env } from './env';
import { looksLikeInviteCode } from './invite';
import { createLineClient, type LineClient } from './line/client';
import { text, THANKS } from './line/messages';
import { classifyReply, isBeforeNoon } from './rules';
import { toJst } from './time';

/** LINE から届くイベントのうち、使う部分だけ */
export interface LineEvent {
  type: string;
  webhookEventId: string;
  replyToken?: string;
  source?: { type: string; userId?: string };
  message?: { type: string; text?: string };
  postback?: { data: string };
}

interface Ctx {
  env: Env;
  db: D1Database;
  line: LineClient;
  now: number;
}

export async function handleEvents(env: Env, events: LineEvent[]): Promise<void> {
  const ctx: Ctx = { env, db: env.DB, line: createLineClient(env.LINE_CHANNEL_ACCESS_TOKEN), now: Date.now() };
  for (const event of events) {
    try {
      // 同じイベントが再送されても、2回処理しない（§13.4）
      if (!(await markEventProcessed(ctx.db, event.webhookEventId, ctx.now))) continue;
      await handleEvent(ctx, event);
    } catch (e) {
      console.error('イベント処理でエラー', event.type, e);
    }
  }
}

async function handleEvent(ctx: Ctx, event: LineEvent): Promise<void> {
  const userId = event.source?.type === 'user' ? event.source.userId : undefined;
  if (!userId) return; // グループなどからのイベントは扱わない

  const user = await getUserByLineId(ctx.db, userId);
  if (!user) return handleUnregistered(ctx, event, userId);
  if (user.role === 'parent') return handleParent(ctx, event, user);
  return handleFamily(ctx, event, user);
}

// ---- 登録前の人（§9.2, §9.9） ----

async function handleUnregistered(ctx: Ctx, event: LineEvent, userId: string): Promise<void> {
  if (!event.replyToken) return;
  if (event.type === 'follow') {
    return void ctx.line.reply(event.replyToken, [text('招待コードを送ってください。')]);
  }
  if (event.type !== 'message' || event.message?.type !== 'text') {
    return void ctx.line.reply(event.replyToken, [text('招待コードを送ってください。')]);
  }
  const input = event.message.text ?? '';

  // 最初の管理者登録：管理者コードと一致し、管理者がまだいないときだけ
  if (ctx.env.ADMIN_SETUP_CODE && input.trim() === ctx.env.ADMIN_SETUP_CODE) {
    const ok = await registerAdmin(ctx.db, userId, ctx.now, toJst(ctx.now).date);
    if (ok) {
      return void ctx.line.reply(event.replyToken, [
        text('管理者として登録しました。「しょうたい」と送ると、ご家族や親御さんを招待できます。'),
      ]);
    }
    // 管理者が登録済みなら、管理者コードは受け付けない（ふつうの未登録者と同じ返事）
  }

  if (looksLikeInviteCode(input)) {
    // TODO ③：招待コードの照合（入力回数制限・期限・1回限り）と、家族／親の登録
    return void ctx.line.reply(event.replyToken, [text('招待コードの登録は準備中です。')]);
  }

  return void ctx.line.reply(event.replyToken, [text('招待コードを送ってください。')]);
}

// ---- 親（§5, §6） ----

async function handleParent(ctx: Ctx, event: LineEvent, parent: UserRow): Promise<void> {
  // TODO ⑯：unfollow（ブロック・削除）/ follow（解除）で家族へ通知
  const method = classifyReply(event);
  if (method === null) return; // 画像・動画・位置情報などは記録も返事もしない（§5.1）

  const today = toJst(ctx.now).date;

  if (method === 'button_unwell') {
    // TODO ⑥：不調ボタン（家族へ即時通知・30分以内の連打防止・親への返事）
    await recordFirstReply(ctx.db, parent.id, today, ctx.now, method);
    return;
  }

  const first = await recordFirstReply(ctx.db, parent.id, today, ctx.now, method);
  // お礼は「その日最初の返信」が「正午より前」のときだけ（§5.3, §5.4）
  if (first && isBeforeNoon(ctx.now) && event.replyToken) {
    if (await ctx.line.reply(event.replyToken, [THANKS])) {
      await markThanksSent(ctx.db, parent.id, today);
    }
  }
}

// ---- 家族（§10） ----

async function handleFamily(ctx: Ctx, event: LineEvent, _user: UserRow): Promise<void> {
  if (!event.replyToken || event.type !== 'message' || event.message?.type !== 'text') return;
  // TODO ⑨⑫⑭：ようす・おやすみ・さいかい・じかん・しょうたい・デモ用コマンド
  await ctx.line.reply(event.replyToken, [text('つかいかた：準備中です。')]);
}
