/** 日本時間の日付と時刻から UNIX ミリ秒を作る（例：jst('2026-11-05', '08:00')） */
export function jst(date: string, hhmm: string): number {
  return Date.parse(`${date}T${hhmm}:00+09:00`);
}
