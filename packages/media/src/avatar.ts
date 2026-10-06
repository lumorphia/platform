import sharp from "sharp";
import { ImageRejectedError, MAX_INPUT_EDGE, MAX_INPUT_PIXELS } from "./types.ts";
import { sniffImage } from "./sharp.ts";

/** アイコンの出力サイズ (px、正方形)。大きい方を表示、小さい方を一覧やメニューで使う */
export const AVATAR_SIZES = [256, 64] as const;
export type AvatarSize = (typeof AVATAR_SIZES)[number];
export const AVATAR_MAX_INPUT_BYTES = 5 * 1024 * 1024;

const MIME_OF = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" } as const;

export type AvatarVariants = Record<AvatarSize, Uint8Array>;

/**
 * アイコン画像を検証し、中央で正方形に切り抜いて各サイズの WebP にする。
 * 投稿画像と同じく EXIF は落とし、向きは rotate() で解決する。失敗は ImageRejectedError。
 */
export async function renderAvatar(
  bytes: Uint8Array,
  declaredMime: string,
): Promise<AvatarVariants> {
  const format = sniffImage(bytes);
  if (!format) throw new ImageRejectedError("unsupported_format");
  if (MIME_OF[format] !== declaredMime) throw new ImageRejectedError("mime_mismatch");
  if (bytes.byteLength > AVATAR_MAX_INPUT_BYTES) throw new ImageRejectedError("too_large");

  let width = 0;
  let height = 0;
  try {
    const meta = await sharp(bytes, {
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: "error",
    }).metadata();
    width = meta.width ?? 0;
    height = meta.height ?? 0;
  } catch {
    throw new ImageRejectedError("decode_failed");
  }
  if (width === 0 || height === 0) throw new ImageRejectedError("decode_failed");
  if (Math.max(width, height) > MAX_INPUT_EDGE) throw new ImageRejectedError("too_large");

  try {
    const out = await Promise.all(
      AVATAR_SIZES.map((size) =>
        sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" })
          .rotate()
          .toColorspace("srgb")
          .resize({ width: size, height: size, fit: "cover", position: "centre" })
          .webp({ quality: 85 })
          .toBuffer(),
      ),
    );
    return Object.fromEntries(
      AVATAR_SIZES.map((size, i) => [size, new Uint8Array(out[i]!)]),
    ) as AvatarVariants;
  } catch {
    throw new ImageRejectedError("decode_failed");
  }
}
