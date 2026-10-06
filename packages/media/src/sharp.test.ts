import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { SharpImageProcessor, sniffImage } from "./sharp.ts";
import { DISPLAY_MAX_EDGE, MAX_INPUT_EDGE, THUMB_MAX_EDGE } from "./types.ts";

// テストの画像は全部ここで作る。リポジトリに画像を置かない (docs/adr/0002)
const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 40, g: 120, b: 200 } } });
const png = async (w: number, h: number) => new Uint8Array(await solid(w, h).png().toBuffer());
const jpeg = async (w: number, h: number) => new Uint8Array(await solid(w, h).jpeg().toBuffer());
const webp = async (w: number, h: number) => new Uint8Array(await solid(w, h).webp().toBuffer());

/** RIFF の末尾に知らないチャンクを足し、RIFF の長さを直す (再編集用 WebP の同梱データを模す) */
function withExtraChunk(bytes: Uint8Array, fourcc: string, payload: Uint8Array): Uint8Array {
  const pad = payload.length % 2;
  const chunk = new Uint8Array(8 + payload.length + pad);
  chunk.set(new TextEncoder().encode(fourcc), 0);
  new DataView(chunk.buffer).setUint32(4, payload.length, true);
  chunk.set(payload, 8);
  const out = new Uint8Array(bytes.length + chunk.length);
  out.set(bytes, 0);
  out.set(chunk, bytes.length);
  new DataView(out.buffer).setUint32(4, out.length - 8, true);
  return out;
}

const includesAscii = (bytes: Uint8Array, text: string) =>
  Buffer.from(bytes).includes(Buffer.from(text, "ascii"));

describe("sniffImage", () => {
  it("detects PNG, JPEG and WebP from the leading bytes", async () => {
    expect(sniffImage(await png(4, 4))).toBe("png");
    expect(sniffImage(await jpeg(4, 4))).toBe("jpeg");
    expect(sniffImage(await webp(4, 4))).toBe("webp");
  });

  it("returns null for anything else", () => {
    expect(sniffImage(new TextEncoder().encode("GIF89a........"))).toBeNull();
    expect(sniffImage(new Uint8Array([0x89, 0x50]))).toBeNull();
  });
});

describe("SharpImageProcessor", () => {
  const processor = new SharpImageProcessor();

  it("rejects an unsupported format", async () => {
    const gif = new TextEncoder().encode("GIF89a........");
    await expect(processor.process(gif, "image/gif")).rejects.toMatchObject({
      reason: "unsupported_format",
    });
  });

  it("rejects a declared MIME type that does not match the bytes", async () => {
    await expect(processor.process(await png(8, 8), "image/jpeg")).rejects.toMatchObject({
      reason: "mime_mismatch",
    });
  });

  it("rejects bytes that look like an image but do not decode", async () => {
    const truncated = (await png(64, 64)).slice(0, 40);
    await expect(processor.process(truncated, "image/png")).rejects.toMatchObject({
      reason: "decode_failed",
    });
  });

  it("rejects an image whose long edge exceeds the input limit", async () => {
    await expect(
      processor.process(await png(MAX_INPUT_EDGE + 1, 1), "image/png"),
    ).rejects.toMatchObject({ reason: "too_large" });
  });

  it("shrinks a large image into the display and thumbnail edges", async () => {
    const out = await processor.process(await png(4000, 1000), "image/png");
    expect([out.width, out.height]).toEqual([DISPLAY_MAX_EDGE, DISPLAY_MAX_EDGE / 4]);
    const thumb = await sharp(out.thumb).metadata();
    expect([thumb.format, thumb.width, thumb.height]).toEqual([
      "webp",
      THUMB_MAX_EDGE,
      THUMB_MAX_EDGE / 4,
    ]);
  });

  it("does not enlarge a small image", async () => {
    const out = await processor.process(await webp(300, 200), "image/webp");
    const display = await sharp(out.display).metadata();
    expect([display.format, display.width, display.height]).toEqual(["webp", 300, 200]);
  });

  it("drops EXIF from the derived images", async () => {
    const withExif = new Uint8Array(
      await solid(64, 32)
        .jpeg()
        .withExif({ IFD0: { Artist: "someone", Copyright: "private note" } })
        .toBuffer(),
    );
    expect((await sharp(withExif).metadata()).exif).toBeDefined();

    const out = await processor.process(withExif, "image/jpeg");
    expect((await sharp(out.display).metadata()).exif).toBeUndefined();
    expect((await sharp(out.thumb).metadata()).exif).toBeUndefined();
  });

  it("bakes the EXIF orientation into the pixels", async () => {
    // orientation 6 = 時計回りに 90 度回して表示する。横長 200x100 は縦長 100x200 になる
    const rotated = new Uint8Array(
      await solid(200, 100).jpeg().withMetadata({ orientation: 6 }).toBuffer(),
    );
    const out = await processor.process(rotated, "image/jpeg");
    expect([out.width, out.height]).toEqual([100, 200]);
  });

  it("drops unknown WebP chunks such as embedded re-edit data", async () => {
    const embedded = withExtraChunk(
      await webp(64, 64),
      "LMRE",
      new TextEncoder().encode("original-image-and-recipe"),
    );
    expect(includesAscii(embedded, "original-image-and-recipe")).toBe(true);

    const out = await processor.process(embedded, "image/webp");
    expect(includesAscii(out.display, "LMRE")).toBe(false);
    expect(includesAscii(out.display, "original-image-and-recipe")).toBe(false);
    expect(includesAscii(out.thumb, "original-image-and-recipe")).toBe(false);
  });

  it("returns a blurhash for the placeholder", async () => {
    const out = await processor.process(await png(120, 80), "image/png");
    expect(out.blurhash).toMatch(/^[0-9A-Za-z#$%*+,\-.:;=?@[\]^_{|}~]{6,}$/);
  });

  it("lets the service choose the display and thumbnail edges", async () => {
    const custom = new SharpImageProcessor({ displayMaxEdge: 3000, thumbMaxEdge: 400 });
    const out = await custom.process(await png(4000, 2000), "image/png");
    expect([out.width, out.height]).toEqual([3000, 1500]);
    const thumb = await sharp(out.thumb).metadata();
    expect([thumb.width, thumb.height]).toEqual([400, 200]);
  });
});
