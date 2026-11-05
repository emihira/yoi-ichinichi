// 「ようす」の表示（仕様書 §10.2）
// DB から読んだ値を受け取り、文字列を組み立てるだけ（テストで確かめられるように）。

import { formatInputLine, type InputKind } from './input';
import { honorific } from './line/messages';
import { isPaused, type ParentInfo, type ReplyMethod } from './rules';
import { addDays, formatJstClock } from './time';

/** 親からの入力（新しい順） */
export interface StatusInput {
  kind: InputKind;
  detail: string | null;
  receivedAt: number;
}

export interface StatusDay {
  date: string;
  morningSentAt: number | null;
  morningFailed: boolean;
  reminderSentAt: number | null;
  noonCheckedAt: number | null;
  firstReplyAt: number | null;
  replyMethod: ReplyMethod | null;
  unwellNotifiedAt: number | null;
  unwellCancelledAt: number | null;
}

const METHOD_LABEL: Record<ReplyMethod, string> = {
  voice: '声',
  button_ok: 'げんきです',
  button_unwell: 'ぐあいがわるい',
  text: '文字',
  sticker: 'スタンプ',
};

/** 1日分の記号：○＝返信あり、×＝返信なし、休＝休止中、－＝判定前・登録前 */
export function dayMark(parent: ParentInfo, day: StatusDay | undefined): string {
  if (day?.firstReplyAt != null) return '○';
  if (isPaused(parent, day?.date ?? '')) return '休';
  if (day?.noonCheckedAt != null) return '×';
  return '－';
}

export function formatParentStatus(
  name: string,
  parent: ParentInfo,
  today: string,
  days: StatusDay[],
  inputs: StatusInput[] = [],
): string {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const t = byDate.get(today);
  const lines = [`【${honorific(name)}】`];

  // けさのメッセージ
  if (parent.status === 'blocked') {
    lines.push('けさのメッセージ：ブロックまたは削除されているため、届きません');
  } else if (isPaused(parent, today)) {
    lines.push(`けさのメッセージ：休止中（${shortDate(parent.pauseUntil!)}まで）`);
  } else if (t?.morningFailed) {
    lines.push('けさのメッセージ：送信できませんでした');
  } else if (t?.morningSentAt != null) {
    lines.push(`けさのメッセージ：${formatJstClock(t.morningSentAt)} 送信`);
  } else if (today <= parent.registeredDate) {
    lines.push('けさのメッセージ：あしたの朝から送ります');
  } else {
    lines.push(`けさのメッセージ：まだ送っていません（${trimHHMM(parent.sendTime)} の予定）`);
  }

  // お返事
  if (t?.firstReplyAt != null) {
    lines.push(`お返事：${formatJstClock(t.firstReplyAt)}（${METHOD_LABEL[t.replyMethod ?? 'text']}）`);
  } else {
    const reminder = t?.reminderSentAt != null ? `（リマインド ${formatJstClock(t.reminderSentAt)} 送信済み）` : '';
    lines.push(`お返事：まだありません${reminder}`);
  }
  if (t?.unwellNotifiedAt != null) {
    const cancelled = t.unwellCancelledAt != null && t.unwellCancelledAt >= t.unwellNotifiedAt;
    lines.push(
      `ぐあいがわるい（${formatJstClock(t.unwellNotifiedAt)}）${cancelled ? ' → 押しまちがいで取り消し' : ''}`,
    );
  }

  // 最近の入力（新しい順）
  if (inputs.length > 0) {
    lines.push('最近の入力：');
    for (const i of inputs) lines.push(`・${formatInputLine(i.kind, i.detail, i.receivedAt, today)}`);
  }

  // この7日間（古い日 → 今日）
  const marks = [];
  for (let i = 6; i >= 0; i--) {
    const date = addDays(today, -i);
    marks.push(date <= parent.registeredDate ? '－' : dayMark(parent, byDate.get(date) ?? emptyDay(date)));
  }
  lines.push(`この7日間：${marks.join('')}`);
  return lines.join('\n');
}

export const STATUS_LEGEND = '（○＝お返事あり、×＝なし、休＝休止中、－＝判定前）';

function emptyDay(date: string): StatusDay {
  return {
    date,
    morningSentAt: null,
    morningFailed: false,
    reminderSentAt: null,
    noonCheckedAt: null,
    firstReplyAt: null,
    replyMethod: null,
    unwellNotifiedAt: null,
    unwellCancelledAt: null,
  };
}

function shortDate(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

function trimHHMM(hhmm: string): string {
  return hhmm.replace(/^0/, '');
}
