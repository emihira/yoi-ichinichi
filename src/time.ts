// 日本時間（Asia/Tokyo, UTC+9）の扱い（仕様書 §3.4）
// 日本には夏時間がないため、UTC に 9 時間を足すだけで正しく変換できる。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export const MINUTE_MS = 60 * 1000;

/** 日本時間での「日付」と「その日の 0:00 からの分数」 */
export interface JstClock {
  /** 'YYYY-MM-DD' */
  date: string;
  /** 0〜1439 */
  minutes: number;
}

export function toJst(at: Date | number): JstClock {
  const ms = typeof at === 'number' ? at : at.getTime();
  const shifted = new Date(ms + JST_OFFSET_MS);
  return {
    date: shifted.toISOString().slice(0, 10),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/** 'HH:MM' → 0:00 からの分数 */
export function parseHHMM(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error(`時刻の形式が正しくありません: ${hhmm}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error(`時刻の範囲が正しくありません: ${hhmm}`);
  return h * 60 + min;
}

/** 0:00 からの分数 → 'H:MM'（画面表示用。先頭の 0 は付けない） */
export function formatClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** UNIX ミリ秒 → 日本時間の 'H:MM' */
export function formatJstClock(ms: number): string {
  return formatClock(toJst(ms).minutes);
}

/** 'YYYY-MM-DD' に日数を足す */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 朝の送信時刻として選べるか：5:00〜10:00、15分刻み（§4.1） */
export function isValidSendTime(hhmm: string): boolean {
  let minutes: number;
  try {
    minutes = parseHHMM(hhmm);
  } catch {
    return false;
  }
  return minutes >= 5 * 60 && minutes <= 10 * 60 && minutes % 15 === 0;
}

export const DEFAULT_SEND_TIME = '08:00';
