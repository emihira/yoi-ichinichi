import { describe, expect, it } from 'vitest';
import { adminNoticePlan, isImportantKind, retryResultLabel } from '../src/failure';
import { createLineClient } from '../src/line/client';

/** LINE の代わりに、決めた順で応答を返す */
function fakeFetch(responses: { status: number; body?: string }[]) {
  const calls: { headers: Record<string, string> }[] = [];
  const impl = (async (_url: string, init: RequestInit) => {
    calls.push({ headers: init.headers as Record<string, string> });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)]!;
    return new Response(r.body ?? '{}', { status: r.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('再試行（§12.2）', () => {
  it('サーバーのエラーは同じ再試行キーで1回だけやり直す', async () => {
    const f = fakeFetch([{ status: 500 }, { status: 500 }]);
    const r = await createLineClient('t', f.impl).push('U1', [], 'key-1');
    expect(r).toMatchObject({ ok: false, retried: true });
    expect(f.calls).toHaveLength(2);
    expect(f.calls.map((c) => c.headers['X-Line-Retry-Key'])).toEqual(['key-1', 'key-1']);
  });
  it('やり直しで「受け付け済み（409）」なら成功', async () => {
    const f = fakeFetch([{ status: 500 }, { status: 409 }]);
    expect((await createLineClient('t', f.impl).push('U1', [], 'k')).ok).toBe(true);
  });
  it('送信数の上限が原因なら、やり直さない', async () => {
    const f = fakeFetch([{ status: 429, body: '{"message":"You have reached your monthly limit."}' }]);
    const r = await createLineClient('t', f.impl).push('U1', [], 'k');
    expect(r).toMatchObject({ ok: false, quotaExceeded: true });
    expect(f.calls).toHaveLength(1);
    expect(retryResultLabel(r)).toBe('quota_exceeded');
  });
  it('宛先の間違いなど（400番台）は、やり直しても直らないので1回だけ', async () => {
    const f = fakeFetch([{ status: 400 }]);
    const r = await createLineClient('t', f.impl).push('U1', [], 'k');
    expect(f.calls).toHaveLength(1);
    expect(retryResultLabel(r)).toBe('not_retried');
  });
});

describe('管理者への通知（§12.1, §12.3）', () => {
  it('重要な通知だけ管理者へ知らせる', () => {
    for (const k of ['morning', 'noon', 'unwell', 'unwell_cancel', 'blocked', 'unblocked']) expect(isImportantKind(k)).toBe(true);
    for (const k of ['reminder', 'input', 'registered', 'reminder_suspended', 'admin_alert']) expect(isImportantKind(k)).toBe(false);
  });
  it('届かなかった相手が管理者本人なら送らない', () => {
    expect(adminNoticePlan(1, [2, 3])).toBe('send');
    expect(adminNoticePlan(1, [1, 2])).toBe('skip_admin_was_target');
    expect(adminNoticePlan(null, [2])).toBe('skip_no_admin');
  });
});
