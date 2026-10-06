import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { AVATAR_MAX_INPUT_BYTES, AVATAR_SIZES, renderAvatar } from "./avatar.ts";

async function png(width: number, height: number) {
  return new Uint8Array(
    await sharp({ create: { width, height, channels: 3, background: "#4a8" } })
      .png()
      .toBuffer(),
  );
}

describe("renderAvatar", () => {
  it("turns a wide or tall image into square WebP icons of every size", async () => {
    for (const [w, h] of [
      [300, 120],
      [120, 300],
    ] as const) {
      const out = await renderAvatar(await png(w, h), "image/png");
      for (const size of AVATAR_SIZES) {
        const meta = await sharp(out[size]).metadata();
        expect([meta.format, meta.width, meta.height]).toEqual(["webp", size, size]);
      }
    }
  });

  it("rejects a declared MIME type that does not match the bytes", async () => {
    await expect(renderAvatar(await png(10, 10), "image/jpeg")).rejects.toMatchObject({
      reason: "mime_mismatch",
    });
  });

  it("rejects an unsupported format", async () => {
    await expect(renderAvatar(new Uint8Array([1, 2, 3, 4]), "image/png")).rejects.toMatchObject({
      reason: "unsupported_format",
    });
  });

  it("rejects a file over the icon size limit", async () => {
    const big = new Uint8Array(AVATAR_MAX_INPUT_BYTES + 1);
    big.set(await png(4, 4));
    await expect(renderAvatar(big, "image/png")).rejects.toMatchObject({ reason: "too_large" });
  });

  it("rejects bytes that look like an image but do not decode", async () => {
    await expect(renderAvatar((await png(64, 64)).slice(0, 40), "image/png")).rejects.toMatchObject(
      { reason: "decode_failed" },
    );
  });
});
