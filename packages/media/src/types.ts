/** 画像変換の境界。サービスの派生画像のジョブが使う (lumorphia/prismtone の docs/design/03 §4 から移した)。 */
export type ImageVariants = {
  width: number;
  height: number;
  display: Uint8Array;
  thumb: Uint8Array;
  /** 一覧のカード用。横幅で揃える。SharpImageProcessor に cardWidth を渡したときだけ作る */
  card?: Uint8Array;
  blurhash: string;
};

export type ImageFormat = "png" | "jpeg" | "webp";

export class ImageRejectedError extends Error {
  readonly reason: "unsupported_format" | "mime_mismatch" | "too_large" | "decode_failed";
  constructor(reason: ImageRejectedError["reason"]) {
    super(reason);
    this.name = "ImageRejectedError";
    this.reason = reason;
  }
}

export interface ImageProcessor {
  /** 形式を先頭バイトで判定する。対応外は null */
  sniff(bytes: Uint8Array): ImageFormat | null;
  /** 検証・メタデータ除去・派生画像生成を行う。失敗は ImageRejectedError */
  process(bytes: Uint8Array, declaredMime: string): Promise<ImageVariants>;
}

export const DISPLAY_MAX_EDGE = 2048;
export const THUMB_MAX_EDGE = 512;
export const MAX_INPUT_PIXELS = 50_000_000;
export const MAX_INPUT_EDGE = 8192;
