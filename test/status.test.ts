import { describe, expect, it } from 'vitest';
import type { ParentInfo } from '../src/rules';
import { formatParentStatus, type StatusDay } from '../src/status';
import { jst } from './helpers';

const TODAY = '2026-11-05';
const parent: ParentInfo = { sendTime: '08:00', status: 'active', pauseUntil: null, registeredDate: '2026-10-01' };

function day(date: string, over: Partial<StatusDay> = {}): StatusDay {
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
    ...over,
  };
}

describe('ようす（§10.2）', () => {
  it('送信時刻・返事の時刻と方法・7日間の記号を表示する', () => {
    const days = [
      day('2026-10-30', { firstReplyAt: 1, noonCheckedAt: 2 }),
      day('2026-10-31', { firstReplyAt: 1 }),
      day('2026-11-01', { firstReplyAt: 1 }),
      day('2026-11-02', { firstReplyAt: 1 }),
      day('2026-11-03', { firstReplyAt: 1 }),
      day('2026-11-04', { noonCheckedAt: jst('2026-11-04', '12:00') }),
      day(TODAY, { morningSentAt: jst(TODAY, '08:00'), firstReplyAt: jst(TODAY, '08:12'), replyMethod: 'voice' }),
    ];
    expect(formatParentStatus('母', parent, TODAY, days)).toBe(
      ['【母さん】', 'けさのメッセージ：8:00 送信', 'お返事：8:12（声）', 'この7日間：○○○○○×○'].join('\n'),
    );
  });

  it('返事がまだで、リマインド済みなら、その時刻も表示する。今日はまだ判定前（－）', () => {
    const days = [
      day(TODAY, { morningSentAt: jst(TODAY, '07:30'), reminderSentAt: jst(TODAY, '08:30') }),
    ];
    const out = formatParentStatus('きみえさん', parent, TODAY, days);
    expect(out).toContain('【きみえさん】');
    expect(out).toContain('お返事：まだありません（リマインド 8:30 送信済み）');
    expect(out).toContain('この7日間：－－－－－－－');
  });

  it('不調ボタンと、その取り消しを表示する', () => {
    const at = jst(TODAY, '10:12');
    const days = [day(TODAY, { morningSentAt: 1, firstReplyAt: at, replyMethod: 'button_unwell', unwellNotifiedAt: at })];
    expect(formatParentStatus('母', parent, TODAY, days)).toContain('ぐあいがわるい（10:12）');
    const cancelled = [{ ...days[0]!, unwellCancelledAt: at + 3 * 60_000 }];
    expect(formatParentStatus('母', parent, TODAY, cancelled)).toContain('押しまちがいで取り消し');
  });

  it('休止中は「休」、登録前の日は「－」', () => {
    const paused = { ...parent, pauseUntil: '2026-11-10', registeredDate: '2026-11-02' };
    const out = formatParentStatus('母', paused, TODAY, [day('2026-11-03', { firstReplyAt: 1 })]);
    expect(out).toContain('けさのメッセージ：休止中（11/10まで）');
    expect(out).toContain('この7日間：－－－－○休休');
  });

  it('朝の送信に失敗した日・まだ送っていない日・ブロック中', () => {
    expect(formatParentStatus('母', parent, TODAY, [day(TODAY, { morningSentAt: 1, morningFailed: true })])).toContain(
      'けさのメッセージ：送信できませんでした',
    );
    expect(formatParentStatus('母', { ...parent, sendTime: '09:15' }, TODAY, [])).toContain(
      'けさのメッセージ：まだ送っていません（9:15 の予定）',
    );
    expect(formatParentStatus('母', { ...parent, status: 'blocked' }, TODAY, [])).toContain('ブロックまたは削除');
  });
});
