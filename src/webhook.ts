// LINE からのイベントの処理（仕様書 §5, §6, §9, §10）

import {
  addInviteAttempt,
  claimInputNotice,
  claimUnwellCancel,
  claimUnwellNotice,
  clearConversation,
  countFailuresSince,
  countUsers,
  createInvite,
  findInvite,
  getConversation,
  getDaysRange,
  getUserByLineId,
  insertInput,
  insertUser,
  listRecentInputs,
  listParentsForStatus,
  markEventProcessed,
  markThanksSent,
  recentInviteAttempts,
  recordFirstReply,
  registerAdmin,
  resetUnwellNotice,
  setConversation,
  toParentInfo,
  useInvite,
  type UserRow,
} from './db';
import type { Env } from './env';
import {
  canAttemptInvite,
  extractInviteCodes,
  generateInviteCode,
  hashInviteCode,
  INVITE_ATTEMPT_WINDOW_MS,
  INVITE_TTL_MS,
  isInviteUsable,
} from './invite';
import { createLineClient, type LineClient } from './line/client';
import {
  ASK_INVITE_CODE,
  ASK_RETAP_LINK,
  inviteCard,
  honorific,
  familyInput,
  familyUnwell,
  familyUnwellCancelled,
  FAMILY_NOTICE,
  inviteChoice,
  text,
  THANKS,
  UNWELL_ALL_FAILED,
  UNWELL_CANCELLED,
  UNWELL_RECENTLY_SENT,
  unwellAckMessage,
  usageText,
} from './line/messages';
import { classifyReply, isBeforeNoon, POSTBACK_UNWELL_CANCEL, registrationDate, UNWELL_DEBOUNCE_MS } from './rules';
import { describeInput, INPUT_NOTICE_INTERVAL_MS, INPUT_RETENTION_DAYS, INPUT_SHOW_MAX, inputLabel, isInputNoticeTarget, type InputKind } from './input';
import { formatParentStatus, STATUS_LEGEND } from './status';
import { addDays, DEFAULT_SEND_TIME, formatJstClock, MINUTE_MS, toJst } from './time';
import { REMINDER_STOP_THRESHOLD } from './quota';
import { monthlyUsage, notifyFamily, remindersSuspended, runDemo, syncLineUsage, type DemoCommand, type Deps } from './watch';

export const MAX_PARENTS = 2;
export const MAX_FAMILY = 3;
const CONVERSATION_TTL_MS = 10 * MINUTE_MS;
const PARENT_NAME_MAX = 10;

/** デモ用コマンド（§16.2）。「デモ:朝」のような半角コロンも受け付ける */
const DEMO_COMMANDS: Record<string, DemoCommand> = {
  'デモ：朝': 'morning',
  'デモ：リマインド': 'reminder',
  'デモ：正午': 'noon',
  'デモ：リセット': 'reset',
};

/** LINE から届くイベントのうち、使う部分だけ */
export interface LineEvent {
  type: string;
  webhookEventId: string;
  replyToken?: string;
  source?: { type: string; userId?: string };
  message?: { type: string; text?: string; duration?: number };
  postback?: { data: string };
}

interface Ctx {
  env: Env;
  db: D1Database;
  line: LineClient;
  now: number;
  today: string;
}

export async function handleEvents(env: Env, events: LineEvent[]): Promise<void> {
  const now = Date.now();
  const ctx: Ctx = {
    env,
    db: env.DB,
    line: createLineClient(env.LINE_CHANNEL_ACCESS_TOKEN),
    now,
    today: toJst(now).date,
  };
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

function deps(ctx: Ctx): Deps {
  return { db: ctx.db, line: ctx.line, greetingApiUrl: ctx.env.GREETING_API_URL, now: ctx.now };
}

async function reply(ctx: Ctx, event: LineEvent, ...messages: Parameters<LineClient['reply']>[1]): Promise<boolean> {
  if (!event.replyToken) return false;
  return ctx.line.reply(event.replyToken, messages);
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
  if (event.type === 'follow') {
    await reply(ctx, event, ASK_RETAP_LINK); // 友だち追加だけで止まってしまったときの案内
    return;
  }
  if (event.type !== 'message' || event.message?.type !== 'text') {
    if (event.type === 'message') await reply(ctx, event, ASK_INVITE_CODE);
    return;
  }
  const input = event.message.text ?? '';

  // 最初の管理者登録：管理者コードと一致し、管理者がまだいないときだけ
  if (ctx.env.ADMIN_SETUP_CODE && input.trim() === ctx.env.ADMIN_SETUP_CODE) {
    if (await registerAdmin(ctx.db, userId, ctx.now, registrationDate(ctx.now))) {
      await reply(
        ctx,
        event,
        text('管理者として登録しました。「しょうたい」と送ると、ご家族や親御さんを招待できます。'),
        text(FAMILY_NOTICE),
      );
      return;
    }
    // 管理者が登録済みなら、管理者コードは受け付けない（ふつうの未登録者と同じ返事）
  }

  const codes = extractInviteCodes(input);
  if (codes.length > 0) return redeemInvite(ctx, event, userId, codes);
  await reply(ctx, event, ASK_INVITE_CODE);
}

/** 招待コードの照合と登録（§9.3〜§9.5） */
async function redeemInvite(ctx: Ctx, event: LineEvent, userId: string, codes: string[]): Promise<void> {
  const attempts = await recentInviteAttempts(ctx.db, userId, ctx.now - INVITE_ATTEMPT_WINDOW_MS);
  if (!canAttemptInvite(attempts, ctx.now)) {
    await reply(ctx, event, text('入力が続いたため、しばらく受け付けを止めています。1時間ほどしてから、もう一度送ってください。'));
    return;
  }
  await addInviteAttempt(ctx.db, userId, ctx.now);

  let invite = null;
  for (const code of codes) {
    invite = await findInvite(ctx.db, await hashInviteCode(code));
    if (invite) break;
  }
  const usable = invite !== null && isInviteUsable({ expiresAt: invite.expires_at, usedAt: invite.used_at }, ctx.now);
  if (!invite || !usable) {
    await reply(ctx, event, text('招待コードが正しくないか、有効期限が切れています。ご家族に確認してください。'));
    return;
  }

  const max = invite.kind === 'parent' ? MAX_PARENTS : MAX_FAMILY;
  if ((await countUsers(ctx.db, invite.kind)) >= max) {
    await reply(ctx, event, text('登録できる人数の上限に達しています。管理者のご家族に確認してください。'));
    return;
  }
  if (!(await useInvite(ctx.db, invite.id, ctx.now))) {
    await reply(ctx, event, text('招待コードが正しくないか、有効期限が切れています。ご家族に確認してください。'));
    return;
  }

  if (invite.kind === 'parent') {
    const name = invite.parent_name ?? 'お母さん';
    await insertUser(
      ctx.db,
      { lineUserId: userId, role: 'parent', displayName: name, sendTime: DEFAULT_SEND_TIME },
      ctx.now,
      registrationDate(ctx.now),
    );
    await reply(ctx, event, text('登録できました。あしたの朝から、おはようのメッセージをお送りします。'));
    await notifyFamily(
      deps(ctx),
      text(`${honorific(name)}の登録が完了しました。あしたの朝8:00から見守りを始めます。`),
      'registered',
    );
    return;
  }

  await insertUser(ctx.db, { lineUserId: userId, role: 'family', displayName: null, sendTime: null }, ctx.now, registrationDate(ctx.now));
  await reply(ctx, event, text('ご家族として登録しました。'), text(FAMILY_NOTICE), usageText(false));
}

// ---- 親（§5, §6） ----

async function handleParent(ctx: Ctx, event: LineEvent, parent: UserRow): Promise<void> {
  // TODO ⑯：unfollow（ブロック・削除）/ follow（解除）で家族へ通知
  if (event.type === 'postback' && event.postback?.data === POSTBACK_UNWELL_CANCEL) {
    return cancelUnwell(ctx, event, parent);
  }

  // 入力はすべて記録する（家族が「ようす」で内容を確かめられるように。11/5 の仕様変更）
  const input = describeInput(event);
  if (input) await insertInput(ctx.db, parent.id, input.kind, input.detail, ctx.now);

  const method = classifyReply(event);
  if (method !== null) {
    // 動画・位置情報・ファイルなどは「返事」には数えず、お礼も返さない（§5.1。写真は 11/5 から数える）
    const first = await recordFirstReply(ctx.db, parent.id, ctx.today, ctx.now, method);
    if (method === 'button_unwell') return notifyUnwell(ctx, event, parent);
    // お礼は「その日最初の返信」が「正午より前」のときだけ（§5.3, §5.4）
    if (first && isBeforeNoon(ctx.now) && (await reply(ctx, event, THANKS))) {
      await markThanksSent(ctx.db, parent.id, ctx.today);
    }
  }

  if (input) await notifyInput(ctx, parent, input.kind);
}

/** 家族へ「入力がありました」。1時間に1回まで。送信枠が残り少ないときは送らない */
async function notifyInput(ctx: Ctx, parent: UserRow, kind: InputKind): Promise<void> {
  if (!isInputNoticeTarget(kind)) return;
  if (await remindersSuspended(deps(ctx))) return;
  if (!(await claimInputNotice(ctx.db, parent.id, ctx.now, INPUT_NOTICE_INTERVAL_MS))) return;
  const name = parent.display_name ?? 'ご家族';
  await notifyFamily(deps(ctx), familyInput(name, formatJstClock(ctx.now), inputLabel(kind)), 'input');
}

/** 不調ボタン：家族全員へ即時通知（§6）。時間帯に関係なく有効 */
async function notifyUnwell(ctx: Ctx, event: LineEvent, parent: UserRow): Promise<void> {
  if (!(await claimUnwellNotice(ctx.db, parent.id, ctx.today, ctx.now, UNWELL_DEBOUNCE_MS))) {
    await reply(ctx, event, UNWELL_RECENTLY_SENT); // 30分以内の連打
    return;
  }
  const name = parent.display_name ?? 'ご家族';
  const { success } = await notifyFamily(deps(ctx), familyUnwell(name, formatJstClock(ctx.now)), 'unwell');
  if (success > 0) {
    await reply(ctx, event, unwellAckMessage());
  } else {
    await resetUnwellNotice(ctx.db, parent.id, ctx.today, ctx.now);
    await reply(ctx, event, UNWELL_ALL_FAILED);
  }
}

/** 押し間違いの取り消し（§6.5）：その日の23:59まで */
async function cancelUnwell(ctx: Ctx, event: LineEvent, parent: UserRow): Promise<void> {
  if (!(await claimUnwellCancel(ctx.db, parent.id, ctx.today, ctx.now))) {
    await reply(ctx, event, text('取り消せるお知らせはありません。'));
    return;
  }
  const name = parent.display_name ?? 'ご家族';
  await notifyFamily(deps(ctx), familyUnwellCancelled(name, formatJstClock(ctx.now)), 'unwell_cancel');
  await reply(ctx, event, UNWELL_CANCELLED);
}

// ---- 家族（§9.3, §10） ----

async function handleFamily(ctx: Ctx, event: LineEvent, user: UserRow): Promise<void> {
  const isAdmin = user.is_admin === 1;

  if (event.type === 'postback') {
    const data = event.postback?.data;
    if (isAdmin && data === 'action=invite_family') return issueInvite(ctx, event, user, 'family', null);
    if (isAdmin && data === 'action=invite_parent') {
      if ((await countUsers(ctx.db, 'parent')) >= MAX_PARENTS) {
        await reply(ctx, event, text(`親御さんは${MAX_PARENTS}人まで登録できます。すでに上限に達しています。`));
        return;
      }
      await setConversation(ctx.db, user.line_user_id, 'invite_parent_name', null, ctx.now + CONVERSATION_TTL_MS);
      await reply(ctx, event, text('親御さんの呼び名を送ってください（10文字まで。例：お母さん）'));
    }
    return;
  }

  if (event.type !== 'message' || event.message?.type !== 'text') return;
  const input = (event.message.text ?? '').trim();

  // 複数手順の操作の途中
  const conv = await getConversation(ctx.db, user.line_user_id, ctx.now);
  if (conv?.operation === 'invite_parent_name' && isAdmin) {
    await clearConversation(ctx.db, user.line_user_id);
    if (input.length === 0 || [...input].length > PARENT_NAME_MAX || /[\r\n]/.test(input)) {
      await reply(ctx, event, text('呼び名は10文字までにしてください。もう一度「しょうたい」から始めてください。'));
      return;
    }
    return issueInvite(ctx, event, user, 'parent', input);
  }

  // 家族が親用の登録リンクを押してしまった場合
  if (extractInviteCodes(input).length > 0) {
    await reply(ctx, event, text('すでにご家族として登録されています。このリンクはご両親のスマートフォンで開いてください。'));
    return;
  }

  const demo = DEMO_COMMANDS[input.replace(/[:：]\s*/, '：')];
  if (demo && isAdmin && ctx.env.DEMO_MODE === 'true') {
    await reply(ctx, event, text(await runDemo(deps(ctx), demo)));
    return;
  }

  switch (input) {
    case 'ようす':
      return void (await reply(ctx, event, text(await statusText(ctx, isAdmin))));
    case 'しょうたい':
      if (isAdmin) return void (await reply(ctx, event, inviteChoice()));
      break;
    // TODO ⑨⑫⑭：ようす・おやすみ・さいかい・じかん・なまえ・デモ用コマンド
  }
  await reply(ctx, event, usageText(isAdmin));
}

/** 招待コードを発行する（§9.3）。親の場合は、押して送信するだけの登録用リンクも付ける（§9.5） */
async function issueInvite(
  ctx: Ctx,
  event: LineEvent,
  admin: UserRow,
  kind: 'family' | 'parent',
  parentName: string | null,
): Promise<void> {
  const max = kind === 'parent' ? MAX_PARENTS : MAX_FAMILY;
  if ((await countUsers(ctx.db, kind)) >= max) {
    await reply(ctx, event, text(`登録できる人数の上限（${max}人）に達しています。`));
    return;
  }
  const code = generateInviteCode();
  await createInvite(
    ctx.db,
    { kind, codeHash: await hashInviteCode(code), parentName, expiresAt: ctx.now + INVITE_TTL_MS, issuedBy: admin.id },
    ctx.now,
  );

  const oaId = ctx.env.LINE_OA_ID;
  const who = kind === 'parent' ? honorific(parentName ?? '') : 'ご家族';
  const link = oaId
    ? kind === 'parent'
      ? `https://line.me/R/oaMessage/${encodeURIComponent(oaId)}/?${code}`
      : `https://line.me/R/ti/p/${encodeURIComponent(oaId)}`
    : null;
  await reply(ctx, event, ...inviteCard(kind, who, code, link));
}

/** ようす（§10.2）。管理者には送信できなかったお知らせの件数も表示する（§12.4） */
async function statusText(ctx: Ctx, isAdmin: boolean): Promise<string> {
  const parents = await listParentsForStatus(ctx.db);
  if (parents.length === 0) return '親御さんがまだ登録されていません。「しょうたい」から招待できます。';
  const from = addDays(ctx.today, -6);
  const blocks: string[] = [];
  for (const p of parents) {
    const days = await getDaysRange(ctx.db, p.id, from, ctx.today);
    const since = ctx.now - INPUT_RETENTION_DAYS * 24 * 60 * MINUTE_MS;
    const inputs = (await listRecentInputs(ctx.db, p.id, since, INPUT_SHOW_MAX)).map((i) => ({
      kind: i.kind as InputKind,
      detail: i.detail,
      receivedAt: i.received_at,
    }));
    blocks.push(formatParentStatus(p.display_name ?? 'ご家族', toParentInfo(p), ctx.today, days, inputs));
  }
  let out = `${blocks.join('\n\n')}\n\n${STATUS_LEGEND}`;
  if (isAdmin) {
    const failures = await countFailuresSince(ctx.db, ctx.now - 7 * 24 * 60 * MINUTE_MS);
    if (failures > 0) out += `\n\n送信できなかったお知らせがあります（この7日間で${failures}件）`;
    // 今月の送信数（§11.2）。その場で LINE の値も取り直す（取得の API は送信数に数えない）
    await syncLineUsage(deps(ctx));
    const u = await monthlyUsage(deps(ctx));
    const lineNote = u.line === null ? 'LINE の記録は取得できませんでした' : `LINE の記録 ${u.line}通${u.quota === null ? '' : `／上限 ${u.quota}通`}`;
    out += `\n\n今月の送信数：${u.own}通（${lineNote}）\n${REMINDER_STOP_THRESHOLD}通を超えると、リマインドと「入力がありました」を止めます。`;
  }
  return out;
}
