// 親からの入力の記録と「入力がありました」の通知（11/5 の仕様変更）
// LINE や D1 には触れない純粋な関数だけを置く。

import { POSTBACK_OK, POSTBACK_UNWELL } from './rules';
import { formatJstClock, MINUTE_MS, toJst } from './time';

/** 「入力がありました」は、前回の通知から1時間以内なら送らない（送信枠を守るため） */
export const INPUT_NOTICE_INTERVAL_MS = 60 * MINUTE_MS;
/** 入力の記録を残す日数 */
export const INPUT_RETENTION_DAYS = 7;
/** 文字の本文を保存する上限 */
export const INPUT_TEXT_MAX = 300;
/** 「ようす」に表示する入力の件数 */
export const INPUT_SHOW_MAX = 5;

export type InputKind =
  | 'voice'
  | 'text'
  | 'sticker'
  | 'button_ok'
  | 'button_unwell'
  | 'image'
  | 'video'
  | 'location'
  | 'file'
  | 'other';

export interface InputRecord {
  kind: InputKind;
  /** 文字：本文。声：秒数。それ以外：null */
  detail: string | null;
}

export interface InputEventLike {
  type: string;
  message?: { type: string; text?: string; duration?: number };
  postback?: { data: string };
}

const MESSAGE_KIND: Record<string, InputKind> = {
  audio: 'voice',
  text: 'text',
  sticker: 'sticker',
  image: 'image',
  video: 'video',
  location: 'location',
  file: 'file',
};

/** 記録する入力か。メッセージと［げんきです］［ぐあいがわるい］ボタンが対象。それ以外は null */
export function describeInput(event: InputEventLike): InputRecord | null {
  if (event.type === 'message' && event.message) {
    const kind = MESSAGE_KIND[event.message.type] ?? 'other';
    if (kind === 'text') return { kind, detail: [...(event.message.text ?? '')].slice(0, INPUT_TEXT_MAX).join('') };
    if (kind === 'voice') {
      const sec = event.message.duration != null ? Math.max(1, Math.round(event.message.duration / 1000)) : null;
      return { kind, detail: sec === null ? null : String(sec) };
    }
    return { kind, detail: null };
  }
  if (event.type === 'postback') {
    if (event.postback?.data === POSTBACK_OK) return { kind: 'button_ok', detail: null };
    if (event.postback?.data === POSTBACK_UNWELL) return { kind: 'button_unwell', detail: null };
  }
  return null;
}

const KIND_LABEL: Record<InputKind, string> = {
  voice: '声',
  text: '文字',
  sticker: 'スタンプ',
  button_ok: '［げんきです］ボタン',
  button_unwell: '［ぐあいがわるい］ボタン',
  image: '写真',
  video: '動画',
  location: '位置情報',
  file: 'ファイル',
  other: 'その他',
};

/** 通知に入れる短い名前（本文は入れない） */
export function inputLabel(kind: InputKind): string {
  return KIND_LABEL[kind] ?? 'その他';
}

/**
 * 「入力がありました」の対象か。［ぐあいがわるい］は専用の通知がすぐ届くので重ねない。
 * 1時間に1回までの制限は、同時に届いた入力でも確実に守れるよう D1 側（claimInputNotice）で行う。
 */
export function isInputNoticeTarget(kind: InputKind): boolean {
  return kind !== 'button_unwell';
}

/** 「ようす」の1行。今日以外は日付も付ける。例：8:01 声（12秒） / 11/4 18:30 文字「おはよう」 */
export function formatInputLine(kind: InputKind, detail: string | null, receivedAt: number, today: string): string {
  const jst = toJst(receivedAt);
  const date = jst.date === today ? '' : `${Number(jst.date.slice(5, 7))}/${Number(jst.date.slice(8, 10))} `;
  let body = inputLabel(kind);
  if (kind === 'voice' && detail) body += `（${detail}秒）`;
  if (kind === 'text' && detail !== null) body += `「${detail}」`;
  return `${date}${formatJstClock(receivedAt)} ${body}`;
}
