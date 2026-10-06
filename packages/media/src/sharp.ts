import sharp, { type Metadata } from "sharp";
import { encode } from "blurhash";
import {
  DISPLAY_MAX_EDGE,
  ImageRejectedError,
  MAX_INPUT_EDGE,
  MAX_INPUT_PIXELS,
  THUMB_MAX_EDGE,
  type ImageFormat,
  type ImageProcessor,
  type ImageVariants,
} from "./types.ts";

const MIME_OF: Record<ImageFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export function sniffImage(bytes: Uint8Array): ImageFormat | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "jpeg";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}

export type SharpImageProcessorOptions = {
  /** 表示用の長辺 (px)。既定 DISPLAY_MAX_EDGE */
  displayMaxEdge?: number;
  /** サムネイルの長辺 (px)。既定 THUMB_MAX_EDGE */
  thumbMaxEdge?: number;
};

/**
 * Sharp による実装。EXIF の向きを焼き込み、メタデータは ICC 以外を落とし、sRGB に統一する。
 * 再エンコードするので、WebP の知らないチャンク (再編集用の同梱データなど) も残らない。
 * 並列度は呼ぶ側 (サービスの worker) で制限する (メモリピーク対策)。
 */
export class SharpImageProcessor implements ImageProcessor {
  private readonly displayMaxEdge: number;
  private readonly thumbMaxEdge: number;

  constructor(options: SharpImageProcessorOptions = {}) {
    this.displayMaxEdge = options.displayMaxEdge ?? DISPLAY_MAX_EDGE;
    this.thumbMaxEdge = options.thumbMaxEdge ?? THUMB_MAX_EDGE;
  }

  sniff(bytes: Uint8Array): ImageFormat | null {
    return sniffImage(bytes);
  }

  async process(bytes: Uint8Array, declaredMime: string): Promise<ImageVariants> {
    const format = sniffImage(bytes);
    if (!format) throw new ImageRejectedError("unsupported_format");
    if (MIME_OF[format] !== declaredMime) throw new ImageRejectedError("mime_mismatch");

    const input = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" });
    let meta: Metadata;
    try {
      meta = await input.metadata();
    } catch {
      throw new ImageRejectedError("decode_failed");
    }
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (w === 0 || h === 0) throw new ImageRejectedError("decode_failed");
    if (Math.max(w, h) > MAX_INPUT_EDGE) throw new ImageRejectedError("too_large");

    try {
      // rotate() で EXIF 方向を解決。withMetadata を付けないので EXIF/XMP は落ちる。ICC は keepIccProfile で保持
      const base = () =>
        sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" })
          .rotate()
          .toColorspace("srgb")
          .keepIccProfile();

      const displayImg = base().resize({
        width: this.displayMaxEdge,
        height: this.displayMaxEdge,
        fit: "inside",
        withoutEnlargement: true,
      });
      const { data: display, info } = await displayImg
        .webp({ quality: 85 })
        .toBuffer({ resolveWithObject: true });

      const thumb = await base()
        .resize({
          width: this.thumbMaxEdge,
          height: this.thumbMaxEdge,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 80 })
        .toBuffer();

      const { data: raw, info: rawInfo } = await sharp(thumb)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const blurhash = encode(
        new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.byteLength),
        rawInfo.width,
        rawInfo.height,
        4,
        3,
      );

      return { width: info.width, height: info.height, display, thumb, blurhash };
    } catch (e) {
      if (e instanceof ImageRejectedError) throw e;
      throw new ImageRejectedError("decode_failed");
    }
  }
}
