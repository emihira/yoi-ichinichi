// wrangler.toml の [[rules]] で、png をそのままのデータ（ArrayBuffer）として読み込む
declare module '*.png' {
  const data: ArrayBuffer;
  export default data;
}
