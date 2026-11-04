// LINE Webhook の署名検証（仕様書 §13.5）
// 受け取った本文そのものを、チャネルシークレットで HMAC-SHA256 にかけ、
// Base64 にした値が x-line-signature ヘッダーと一致するかを確かめる。

export async function computeSignature(channelSecret: string, rawBody: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(channelSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function verifySignature(
  channelSecret: string,
  rawBody: string,
  signature: string | null,
): Promise<boolean> {
  if (!signature || !channelSecret) return false;
  const expected = await computeSignature(channelSecret, rawBody);
  return timingSafeEqual(expected, signature);
}

/** 比較にかかる時間から値を推測されないよう、長さが同じなら最後まで比べる */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
