import { describe, expect, it } from 'vitest';
import {
  chooseHourMessage,
  chooseMinuteMessage,
  dateWithWeekday,
  decodeAction,
  encodeAction,
  FAMILY_ACTION_TTL_MS,
  isValidPauseUntil,
  pauseDoneText,
  resumeOutcome,
  resumeText,
  sendTimeApply,
  sendTimeDoneText,
} from '../src/family';
import { shouldSendMorning, EMPTY_DAY, type ParentInfo } from '../src/rules';
import { jst } from './helpers';

const TODAY = '2026-11-06';
const NOW = jst(TODAY, '09:00');
const parent: ParentInfo = { sendTime: '08:00', status: 'active', pauseUntil: null, registeredDate: '2026-11-04' };

type QuickReplyItem = { action: { label: string; data: string } };
const items = (m: Record<string, unknown>) => (m.quickReply as { items: QuickReplyItem[] }).items;

describe('ボタンの中の途中状態（§10.1）', () => {
  it('作ったボタンを読み戻せる', () => {
    for (const a of [
      { a: 'pause', p: 3 },
      { a: 'resume', p: 3 },
      { a: 'time_h', p: 3, h: 7 },
      { a: 'time_set', p: 3, v: '07:30' },
    ] as const) {
      expect(decodeAction(encodeAction(a, NOW), NOW + 60_000)).toEqual(a);
    }
  });
  it('10分を過ぎたボタンは受け付けない', () => {
    const data = encodeAction({ a: 'pause', p: 3 }, NOW);
    expect(decodeAction(data, NOW + FAMILY_ACTION_TTL_MS)).toEqual({ a: 'pause', p: 3 });
    expect(decodeAction(data, NOW + FAMILY_ACTION_TTL_MS + 1)).toBe('expired');
  });
  it('ほかのボタンや、書き換えられた中身は受け付けない', () => {
    expect(decodeAction('action=ok', NOW)).toBeNull();
    expect(decodeAction('fa=delete&p=3&t=' + NOW, NOW)).toBeNull();
    expect(decodeAction('fa=pause&p=abc&t=' + NOW, NOW)).toBeNull();
    expect(decodeAction(`fa=time_set&p=3&v=04:00&t=${NOW}`, NOW)).toBeNull();
    expect(decodeAction(`fa=time_set&p=3&v=07:10&t=${NOW}`, NOW)).toBeNull();
    expect(decodeAction(`fa=time_h&p=3&h=11&t=${NOW}`, NOW)).toBeNull();
  });
});

describe('おやすみ・さいかい（§10.3）', () => {
  it('お休みの最後の日は今日以降の日付だけ', () => {
    expect(isValidPauseUntil('2026-11-06', TODAY)).toBe(true);
    expect(isValidPauseUntil('2026-11-10', TODAY)).toBe(true);
    expect(isValidPauseUntil('2026-11-05', TODAY)).toBe(false);
    expect(isValidPauseUntil('2026-02-30', TODAY)).toBe(false);
    expect(isValidPauseUntil(undefined, TODAY)).toBe(false);
  });
  it('最後の日の翌朝から再開する（判定と文面）', () => {
    const paused = { ...parent, pauseUntil: '2026-11-10' };
    expect(shouldSendMorning(paused, EMPTY_DAY, jst('2026-11-10', '08:00'))).toBe(false);
    expect(shouldSendMorning(paused, EMPTY_DAY, jst('2026-11-11', '08:00'))).toBe(true);
    expect(pauseDoneText('はなこ', '2026-11-10', TODAY)).toContain('11/10（火）までお休み');
    expect(pauseDoneText('はなこ', '2026-11-10', TODAY)).toContain('11/11（水）の朝から');
  });
  it('「さいかい」は休止中なら翌朝から。休止していなければそう伝える', () => {
    expect(resumeOutcome({ ...parent, pauseUntil: '2026-11-10' }, TODAY)).toBe('resume_tomorrow');
    expect(resumeOutcome({ ...parent, pauseUntil: '2026-11-05' }, TODAY)).toBe('not_paused');
    expect(resumeOutcome(parent, TODAY)).toBe('not_paused');
    expect(resumeText('はなこ', 'resume_tomorrow', TODAY)).toContain('11/7（土）の朝から再開');
  });
  it('曜日を付けて日付を表示する', () => {
    expect(dateWithWeekday('2026-11-08')).toBe('11/8（日）');
  });
});

describe('じかん（§10.4）', () => {
  it('時は 5時〜10時、分は 00・15・30・45。10時は 10:00 だけ', () => {
    const hour = items(chooseHourMessage({ id: 3, name: 'はなこ' }, '08:00', NOW));
    expect(hour.map((i) => i.action.label)).toEqual(['5時', '6時', '7時', '8時', '9時', '10時']);
    expect(items(chooseMinuteMessage({ id: 3, name: 'はなこ' }, 7, NOW)).map((i) => i.action.label)).toEqual([
      '7:00',
      '7:15',
      '7:30',
      '7:45',
    ]);
    expect(items(chooseMinuteMessage({ id: 3, name: 'はなこ' }, 10, NOW)).map((i) => i.action.label)).toEqual(['10:00']);
  });
  it('けさの分を送っていれば翌日から、まだなら今日から', () => {
    expect(sendTimeApply(true)).toBe('tomorrow');
    expect(sendTimeApply(false)).toBe('today');
  });
  it('変更後の時刻と適用日を返す', () => {
    expect(sendTimeDoneText('はなこ', '07:30', 'tomorrow', TODAY, 9 * 60, true)).toContain('11/7（土）から 7:30');
    expect(sendTimeDoneText('はなこ', '09:30', 'today', TODAY, 9 * 60, true)).toContain('今日から 9:30');
    // まだ送っていない日に、今より前の時刻にしたら、すぐ送ることを伝える
    expect(sendTimeDoneText('はなこ', '07:30', 'today', TODAY, 9 * 60, true)).toContain('まもなくお送りします');
    expect(sendTimeDoneText('はなこ', '07:30', 'today', TODAY, 9 * 60, false)).not.toContain('まもなく');
  });
});

describe('親のブロック・友だち削除（§9.7）', async () => {
  const { familyParentBlocked, familyParentUnblocked } = await import('../src/line/messages');
  const { isWatchedToday } = await import('../src/rules');
  it('家族へのお知らせの文面', () => {
    expect(familyParentBlocked('はなこ').text).toBe(
      'はなこさんのLINEで、このアカウントがブロックまたは削除されました。朝のメッセージが届かなくなっています。',
    );
    expect(familyParentUnblocked('はなこ').text).toContain('朝のメッセージを再開します');
  });
  it('ブロック中は見守り処理をしない', () => {
    expect(isWatchedToday({ ...parent, status: 'blocked' }, TODAY)).toBe(false);
    expect(isWatchedToday(parent, TODAY)).toBe(true);
  });
});

describe('なまえ（§10.5）', async () => {
  const { isValidParentName, nameDoneText, FAMILY_COMMANDS } = await import('../src/family');
  it('呼び名は1〜10文字、改行なし', () => {
    expect(isValidParentName('お母さん')).toBe(true);
    expect(isValidParentName('あいうえおかきくけこ')).toBe(true);
    expect(isValidParentName('あいうえおかきくけこさ')).toBe(false);
    expect(isValidParentName('')).toBe(false);
    expect(isValidParentName('お母\nさん')).toBe(false);
  });
  it('呼び名の入力待ちでも、決まった言葉は操作として扱う', () => {
    expect(FAMILY_COMMANDS).toContain('ようす');
    expect(FAMILY_COMMANDS).toContain('なまえ');
  });
  it('変更の結果を返す', () => {
    expect(nameDoneText('はなこさん', 'お母さん')).toBe('呼び名を「はなこさん」から「お母さん」に変えました。');
  });
  it('親を選ぶボタンを読み戻せる', () => {
    expect(decodeAction(encodeAction({ a: 'name', p: 3 }, NOW), NOW)).toEqual({ a: 'name', p: 3 });
  });
});
