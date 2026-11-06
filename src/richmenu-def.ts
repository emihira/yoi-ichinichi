// 家族用リッチメニューの定義（仕様書 §10.6）。画像を読み込まないので、テストからも使える

/** 画像を作り直したら版を上げる（新しいメニューを作って付け替える） */
export const RICHMENU_VERSION = 'v1';

export const RICHMENU_COMMANDS = ['ようす', 'おやすみ', 'じかん', 'つかいかた'] as const;

/** メニューの定義：2500×843 を横に4等分 */
export function familyRichMenu() {
  const width = 2500;
  const height = 843;
  const w = Math.floor(width / RICHMENU_COMMANDS.length);
  return {
    size: { width, height },
    selected: true,
    name: `family-${RICHMENU_VERSION}`,
    chatBarText: 'メニュー',
    areas: RICHMENU_COMMANDS.map((command, i) => ({
      bounds: { x: i * w, y: 0, width: i === RICHMENU_COMMANDS.length - 1 ? width - i * w : w, height },
      action: { type: 'message', text: command },
    })),
  };
}

