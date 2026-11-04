// Cloudflare Workers に渡される設定値（仕様書 §13.6）

export interface Env {
  DB: D1Database;
  // シークレット（`npx wrangler secret put` で登録。コードには書かない）
  LINE_CHANNEL_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  ADMIN_SETUP_CODE: string;
  // 変数（wrangler.toml の [vars]）
  LINE_OA_ID: string;
  GREETING_API_URL: string;
  DEMO_MODE: string;
}
