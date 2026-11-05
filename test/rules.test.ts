import { describe, expect, it } from 'vitest';
import {
  canCancelUnwell,
  classifyReply,
  EMPTY_DAY,
  isBeforeNoon,
  noonOutcome,
  shouldNotifyUnwell,
  shouldRunNoonCheck,
  shouldSendMorning,
  shouldSendReminder,
  type DayState,
  type ParentInfo,
} from '../src/rules';
import { jst } from './helpers';

const TODAY = '2026-11-05';
const parent: ParentInfo = { sendTime: '08:00', status: 'active', pauseUntil: null, registeredDate: '2026-11-04' };
const sentAt8 = jst(TODAY, '08:00');
const sentDay: DayState = { ...EMPTY_DAY, morningSentAt: sentAt8 };

describe('朝の送信判定（§3.4, §4.1）', () => {
  it('送信時刻の前は送らない', () => {
    expect(shouldSendMorning(parent, EMPTY_DAY, jst(TODAY, '07:55'))).toBe(false);
  });
  it('送信時刻ちょうどに送る', () => {
    expect(shouldSendMorning(parent, EMPTY_DAY, jst(TODAY, '08:00'))).toBe(true);
  });
  it('Cron が遅れても、送信時刻を過ぎていれば送る', () => {
    expect(shouldSendMorning(parent, EMPTY_DAY, jst(TODAY, '08:13'))).toBe(true);
  });
  it('2回目は送らない', () => {
    expect(shouldSendMorning(parent, sentDay, jst(TODAY, '08:05'))).toBe(false);
  });
  it('休止中は送らない。休止の最終日の翌朝から再開する', () => {
    const paused = { ...parent, pauseUntil: TODAY };
    expect(shouldSendMorning(paused, EMPTY_DAY, jst(TODAY, '08:00'))).toBe(false);
    expect(shouldSendMorning(paused, EMPTY_DAY, jst('2026-11-06', '08:00'))).toBe(true);
  });
  it('ブロック・削除された親には送らない', () => {
    expect(shouldSendMorning({ ...parent, status: 'blocked' }, EMPTY_DAY, jst(TODAY, '08:00'))).toBe(false);
  });
  it('登録した当日は送らない（翌朝から）', () => {
    const justRegistered = { ...parent, registeredDate: TODAY };
    expect(shouldSendMorning(justRegistered, EMPTY_DAY, jst(TODAY, '11:00'))).toBe(false);
  });
});

describe('リマインド判定（§7）', () => {
  it('送信から60分たつ前は送らない', () => {
    expect(shouldSendReminder(parent, sentDay, jst(TODAY, '08:55'), false)).toBe(false);
  });
  it('送信の60分後に未返信なら送る', () => {
    expect(shouldSendReminder(parent, sentDay, jst(TODAY, '09:00'), false)).toBe(true);
  });
  it('返信済みなら送らない', () => {
    const replied = { ...sentDay, firstReplyAt: jst(TODAY, '08:10') };
    expect(shouldSendReminder(parent, replied, jst(TODAY, '09:00'), false)).toBe(false);
  });
  it('朝の挨拶より前に返信していても送らない', () => {
    const early = { ...sentDay, firstReplyAt: jst(TODAY, '06:30') };
    expect(shouldSendReminder(parent, early, jst(TODAY, '09:00'), false)).toBe(false);
  });
  it('送信済みなら送らない（1日1回まで）', () => {
    const reminded = { ...sentDay, reminderSentAt: jst(TODAY, '09:00') };
    expect(shouldSendReminder(parent, reminded, jst(TODAY, '09:05'), false)).toBe(false);
  });
  it('12:00 以降は送らない', () => {
    const late = { ...EMPTY_DAY, morningSentAt: jst(TODAY, '11:30') };
    expect(shouldSendReminder(parent, late, jst(TODAY, '12:30'), false)).toBe(false);
  });
  it('月間送信数によるリマインド停止中は送らない', () => {
    expect(shouldSendReminder(parent, sentDay, jst(TODAY, '09:00'), true)).toBe(false);
  });
  it('朝の送信に失敗した日は送らない', () => {
    expect(shouldSendReminder(parent, { ...sentDay, morningFailed: true }, jst(TODAY, '09:00'), false)).toBe(false);
  });
  it('休止中は送らない', () => {
    expect(shouldSendReminder({ ...parent, pauseUntil: TODAY }, sentDay, jst(TODAY, '09:00'), false)).toBe(false);
  });
  it('10:00 送信の親には 11:00 にリマインドする', () => {
    const p10 = { ...parent, sendTime: '10:00' };
    const d10 = { ...EMPTY_DAY, morningSentAt: jst(TODAY, '10:00') };
    expect(shouldSendReminder(p10, d10, jst(TODAY, '10:55'), false)).toBe(false);
    expect(shouldSendReminder(p10, d10, jst(TODAY, '11:00'), false)).toBe(true);
  });
});

describe('正午判定（§8）', () => {
  it('12:00 より前は判定しない', () => {
    expect(shouldRunNoonCheck(parent, sentDay, jst(TODAY, '11:55'))).toBe(false);
  });
  it('12:00 以降に判定する（Cron が遅れても）', () => {
    expect(shouldRunNoonCheck(parent, sentDay, jst(TODAY, '12:00'))).toBe(true);
    expect(shouldRunNoonCheck(parent, sentDay, jst(TODAY, '12:20'))).toBe(true);
  });
  it('1日1回だけ判定する', () => {
    const checked = { ...sentDay, noonCheckedAt: jst(TODAY, '12:00') };
    expect(shouldRunNoonCheck(parent, checked, jst(TODAY, '12:05'))).toBe(false);
  });
  it('休止中は判定しない', () => {
    expect(shouldRunNoonCheck({ ...parent, pauseUntil: TODAY }, sentDay, jst(TODAY, '12:00'))).toBe(false);
  });
  it('登録した当日は判定しない', () => {
    expect(shouldRunNoonCheck({ ...parent, registeredDate: TODAY }, EMPTY_DAY, jst(TODAY, '12:00'))).toBe(false);
  });
  it('返信があれば通知しない／なければ通常の文面／朝の送信失敗なら専用の文面', () => {
    expect(noonOutcome({ ...sentDay, firstReplyAt: jst(TODAY, '08:12') })).toBe('replied');
    expect(noonOutcome(sentDay)).toBe('no_reply');
    expect(noonOutcome({ ...sentDay, morningFailed: true })).toBe('morning_failed');
  });
  it('正午前かどうか（お礼を送るか）', () => {
    expect(isBeforeNoon(jst(TODAY, '11:59'))).toBe(true);
    expect(isBeforeNoon(jst(TODAY, '12:00'))).toBe(false);
  });
});

describe('返信の種類（§5.1）', () => {
  it('音声・文字・スタンプ・ボタンは有効', () => {
    expect(classifyReply({ type: 'message', message: { type: 'audio' } })).toBe('voice');
    expect(classifyReply({ type: 'message', message: { type: 'text' } })).toBe('text');
    expect(classifyReply({ type: 'message', message: { type: 'sticker' } })).toBe('sticker');
    expect(classifyReply({ type: 'postback', postback: { data: 'action=ok' } })).toBe('button_ok');
    expect(classifyReply({ type: 'postback', postback: { data: 'action=unwell' } })).toBe('button_unwell');
  });
  it('写真も有効（11/5 の仕様変更）', () => {
    expect(classifyReply({ type: 'message', message: { type: 'image' } })).toBe('image');
  });
  it('動画・ファイル・位置情報は無効', () => {
    for (const type of ['video', 'file', 'location']) {
      expect(classifyReply({ type: 'message', message: { type } })).toBeNull();
    }
  });
  it('メッセージ以外のイベントや、知らないボタンは無効', () => {
    expect(classifyReply({ type: 'follow' })).toBeNull();
    expect(classifyReply({ type: 'postback', postback: { data: 'action=unknown' } })).toBeNull();
  });
});

describe('不調ボタン（§6.4, §6.5）', () => {
  const at = jst(TODAY, '10:12');
  it('初めての不調は通知する', () => {
    expect(shouldNotifyUnwell(null, at)).toBe(true);
  });
  it('30分以内の連打では再通知しない', () => {
    expect(shouldNotifyUnwell(at, at + 29 * 60_000)).toBe(false);
  });
  it('30分を過ぎたら新しい通知として送る', () => {
    expect(shouldNotifyUnwell(at, at + 30 * 60_000)).toBe(true);
  });
  it('取り消しはその日の23:59まで、1回だけ', () => {
    expect(canCancelUnwell(at, null, jst(TODAY, '23:59'))).toBe(true);
    expect(canCancelUnwell(at, null, jst('2026-11-06', '00:00'))).toBe(false);
    expect(canCancelUnwell(at, at + 60_000, at + 120_000)).toBe(false);
    expect(canCancelUnwell(null, null, at)).toBe(false);
  });
});

describe('呼び名の敬称', async () => {
  const { honorific } = await import('../src/line/messages');
  it('「さん」などで終わっていなければ「さん」を付ける', () => {
    expect(honorific('母')).toBe('母さん');
    expect(honorific('はなこさん')).toBe('はなこさん');
    expect(honorific('お母様')).toBe('お母様');
    expect(honorific('みよちゃん')).toBe('みよちゃん');
  });
});

describe('登録日（午前5時より前は前日の登録）', async () => {
  const { registrationDate } = await import('../src/rules');
  it('0:30 の登録は前日、5:00 以降はその日', () => {
    expect(registrationDate(jst('2026-11-05', '00:30'))).toBe('2026-11-04');
    expect(registrationDate(jst('2026-11-05', '04:59'))).toBe('2026-11-04');
    expect(registrationDate(jst('2026-11-05', '05:00'))).toBe('2026-11-05');
    expect(registrationDate(jst('2026-11-04', '23:30'))).toBe('2026-11-04');
  });
  it('0:30 に登録した親には、その日の朝から送る', () => {
    const p = { ...parent, registeredDate: registrationDate(jst('2026-11-05', '00:30')) };
    expect(shouldSendMorning(p, EMPTY_DAY, jst('2026-11-05', '08:00'))).toBe(true);
  });
});
