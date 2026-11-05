// 家族の操作「おやすみ」「さいかい」「じかん」（仕様書 §10.3, §10.4）
// 親を選ぶ → 日付や時刻を選ぶ、の途中状態はボタンの中（postback の data）に持たせる。
// ボタンには作った時刻を入れておき、10分を過ぎたボタンは受け付けない（§10.1）。
// ここには LINE や D1 に触れない「純粋な関数」だけを置く。

import { honorific } from './line/messages';
import type { LineMessage } from './line/client';
import { isPaused, type ParentInfo } from './rules';
import { addDays, formatClock, isValidSendTime, MINUTE_MS, parseHHMM } from './time';

export const FAMILY_ACTION_TTL_MS = 10 * MINUTE_MS;

export type FamilyAction =
  | { a: 'pause'; p: number } // 親を選んだ → 終了日のカレンダーへ
  | { a: 'pause_until'; p: number } // カレンダーで日付を選んだ（日付は postback.params.date）
  | { a: 'resume'; p: number }
  | { a: 'time'; p: number } // 親を選んだ → 時を選ぶ
  | { a: 'time_h'; p: number; h: number } // 時を選んだ → 分を選ぶ
  | { a: 'time_set'; p: number; v: string }; // 時刻が決まった

const ACTIONS = ['pause', 'pause_until', 'resume', 'time', 'time_h', 'time_set'] as const;

/** ボタンに入れる文字列を作る。t はボタンを作った時刻 */
export function encodeAction(action: FamilyAction, t: number): string {
  const q = new URLSearchParams({ fa: action.a, p: String(action.p), t: String(t) });
  if (action.a === 'time_h') q.set('h', String(action.h));
  if (action.a === 'time_set') q.set('v', action.v);
  return q.toString();
}

/**
 * ボタンの文字列を読む。家族の操作のボタンでなければ null、10分を過ぎていれば 'expired'。
 * 中身は利用者が書き換えられるものとして、形式を確かめる。
 */
export function decodeAction(data: string, now: number): FamilyAction | 'expired' | null {
  const q = new URLSearchParams(data);
  const a = q.get('fa');
  if (!a || !(ACTIONS as readonly string[]).includes(a)) return null;
  const p = Number(q.get('p'));
  const t = Number(q.get('t'));
  if (!Number.isInteger(p) || p <= 0 || !Number.isFinite(t)) return null;
  if (now - t > FAMILY_ACTION_TTL_MS || t > now + MINUTE_MS) return 'expired';
  switch (a) {
    case 'time_h': {
      const h = Number(q.get('h'));
      return Number.isInteger(h) && h >= 5 && h <= 10 ? { a, p, h } : null;
    }
    case 'time_set': {
      const v = q.get('v') ?? '';
      return isValidSendTime(v) ? { a, p, v } : null;
    }
    default:
      return { a: a as 'pause' | 'pause_until' | 'resume' | 'time', p };
  }
}

/** 'YYYY-MM-DD' → '11/10（火）' */
export function dateWithWeekday(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const w = '日月火水木金土'[d.getUTCDay()];
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${w}）`;
}

// ---- おやすみ ----

/** 休止の最終日として受け付けるか：今日以降の、正しい形の日付 */
export function isValidPauseUntil(date: string | undefined, today: string): date is string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  if (Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || addDays(date, 0) !== date) return false;
  return date >= today;
}

export function pauseDoneText(name: string, until: string, today: string): string {
  const resume = dateWithWeekday(addDays(until, 1));
  const range = until === today ? '今日' : `${dateWithWeekday(until)}まで`;
  return `${honorific(name)}の見守りを、${range}お休みにしました。${resume}の朝から、自動で再開します。\n\nお休みのあいだは、朝のメッセージ・リマインド・正午のお知らせを止めます。早めに再開するときは「さいかい」と送ってください。`;
}

// ---- さいかい ----

export type ResumeOutcome = 'not_paused' | 'resume_tomorrow';

/** 休止中なら、休止の最終日を今日にする（翌朝から再開。§10.3-4） */
export function resumeOutcome(parent: ParentInfo, today: string): ResumeOutcome {
  return isPaused(parent, today) ? 'resume_tomorrow' : 'not_paused';
}

export function resumeText(name: string, outcome: ResumeOutcome, today: string): string {
  if (outcome === 'not_paused') return `${honorific(name)}の見守りは、お休みしていません。`;
  return `${honorific(name)}の見守りを、${dateWithWeekday(addDays(today, 1))}の朝から再開します。`;
}

// ---- じかん ----

export type SendTimeApply = 'today' | 'tomorrow';

/** 今日の朝の送信がすでに済んでいれば翌日から、まだなら今日から（§10.4-3） */
export function sendTimeApply(morningSentToday: boolean): SendTimeApply {
  return morningSentToday ? 'tomorrow' : 'today';
}

/** 'HH:MM' → 'H:MM' */
export function displayTime(hhmm: string): string {
  return formatClock(parseHHMM(hhmm));
}

export function sendTimeDoneText(
  name: string,
  hhmm: string,
  apply: SendTimeApply,
  today: string,
  nowMinutes: number,
  watchedToday: boolean,
): string {
  const who = honorific(name);
  const time = displayTime(hhmm);
  if (apply === 'tomorrow') {
    return `${who}の朝のメッセージを ${time} に変えます。けさの分は送ったので、${dateWithWeekday(addDays(today, 1))}から ${time} にお送りします。`;
  }
  const soon = watchedToday && parseHHMM(hhmm) <= nowMinutes ? '\nけさのメッセージは、まもなくお送りします。' : '';
  return `${who}の朝のメッセージを ${time} に変えました。今日から ${time} にお送りします。${soon}`;
}

// ---- ボタン ----

export interface ParentChoice {
  id: number;
  name: string;
}

function postbackItem(label: string, data: string, displayText = label) {
  return { type: 'action', action: { type: 'postback', label, data, displayText } };
}

/** 親が2人のとき、どの親の操作かを選ぶボタン（§10.1） */
export function chooseParentMessage(
  question: string,
  parents: ParentChoice[],
  action: (p: number) => FamilyAction,
  now: number,
): LineMessage {
  return {
    type: 'text',
    text: question,
    quickReply: { items: parents.map((p) => postbackItem(honorific(p.name), encodeAction(action(p.id), now))) },
  };
}

/** 休止の最終日をカレンダーで選ぶ（LINE の日付選択） */
export function pauseDateMessage(parent: ParentChoice, today: string, now: number): LineMessage {
  return {
    type: 'text',
    text: `${honorific(parent.name)}の見守りを、いつまでお休みにしますか？\n下の［日付をえらぶ］を押して、お休みの最後の日を選んでください。その翌朝から自動で再開します。`,
    quickReply: {
      items: [
        {
          type: 'action',
          action: {
            type: 'datetimepicker',
            label: '日付をえらぶ',
            data: encodeAction({ a: 'pause_until', p: parent.id }, now),
            mode: 'date',
            initial: addDays(today, 1),
            min: today,
          },
        },
      ],
    },
  };
}

/** 時を選ぶ：5時〜10時 */
export function chooseHourMessage(parent: ParentChoice, currentHHMM: string, now: number): LineMessage {
  const items = [5, 6, 7, 8, 9, 10].map((h) => postbackItem(`${h}時`, encodeAction({ a: 'time_h', p: parent.id, h }, now)));
  return {
    type: 'text',
    text: `${honorific(parent.name)}の朝のメッセージは、いま ${displayTime(currentHHMM)} です。何時に変えますか？`,
    quickReply: { items },
  };
}

/** 分を選ぶ：00・15・30・45。10時は 10:00 だけ（§10.4-2） */
export function chooseMinuteMessage(parent: ParentChoice, hour: number, now: number): LineMessage {
  const minutes = hour === 10 ? [0] : [0, 15, 30, 45];
  const items = minutes.map((m) => {
    const v = `${String(hour).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    return postbackItem(displayTime(v), encodeAction({ a: 'time_set', p: parent.id, v }, now));
  });
  return { type: 'text', text: `${hour}時の何分にしますか？`, quickReply: { items } };
}

export const ACTION_EXPIRED =
  'ボタンを押すまでに10分以上たったため、受け付けられませんでした。もう一度「おやすみ」「さいかい」「じかん」から始めてください。';
