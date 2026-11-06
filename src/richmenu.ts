// 家族用リッチメニュー（仕様書 §10.6）
// 画面の下に「ようす」「おやすみ」「じかん」「つかいかた」のボタンを出す。押すとその言葉が送られる。
// 親御さんには付けない（マイクのボタンを押しやすいままにするため）。
// アクセストークンは Worker の中だけで使い、手元のパソコンやチャットに出さない。

import { getSetting, listFamily, setSetting } from './db';
import type { Env } from './env';
import menuImage from '../assets/richmenu-family.png';

import { familyRichMenu, RICHMENU_VERSION } from './richmenu-def';

const SETTING_KEY = `family_richmenu_id:${RICHMENU_VERSION}`;
const API = 'https://api.line.me/v2/bot';
const DATA_API = 'https://api-data.line.me/v2/bot';

async function call(token: string, url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`リッチメニューの操作に失敗 ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res;
}

/** メニューが無ければ作って画像を登録し、IDを保存する */
async function ensureMenu(env: Env): Promise<string> {
  const saved = await getSetting(env.DB, SETTING_KEY);
  if (saved) return saved;
  const token = env.LINE_CHANNEL_ACCESS_TOKEN;
  const res = await call(token, `${API}/richmenu`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(familyRichMenu()),
  });
  const { richMenuId } = (await res.json()) as { richMenuId: string };
  await call(token, `${DATA_API}/richmenu/${richMenuId}/content`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png' },
    body: menuImage,
  });
  await setSetting(env.DB, SETTING_KEY, richMenuId);
  return richMenuId;
}

/** ご家族にメニューを付ける。lineUserIds を省くと登録中のご家族全員。付けた人数を返す */
export async function linkFamilyMenu(env: Env, lineUserIds?: string[]): Promise<number> {
  const ids = lineUserIds ?? (await listFamily(env.DB)).map((f) => f.line_user_id);
  if (ids.length === 0) return 0;
  const richMenuId = await ensureMenu(env);
  await call(env.LINE_CHANNEL_ACCESS_TOKEN, `${API}/richmenu/bulk/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ richMenuId, userIds: ids }),
  });
  return ids.length;
}

/** 削除したご家族からメニューを外す */
export async function unlinkMenu(env: Env, lineUserId: string): Promise<void> {
  await call(env.LINE_CHANNEL_ACCESS_TOKEN, `${API}/user/${encodeURIComponent(lineUserId)}/richmenu`, { method: 'DELETE' });
}
