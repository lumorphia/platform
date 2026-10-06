import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FsStorage } from "./fs.ts";

describe("FsStorage", () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "lumorphia-fs-"));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("keeps objects on disk so another instance sees them", async () => {
    const a = new FsStorage({ root });
    await a.put({
      key: "a/1/thumb.webp",
      body: new Uint8Array([1, 2, 3]),
      contentType: "image/webp",
      cacheControl: "public, max-age=1",
    });
    await a.put({ key: "a/1/display.webp", body: new Uint8Array([4]), contentType: "image/webp" });
    await a.put({ key: "tmp/u1", body: new Uint8Array([5]), contentType: "image/png" });

    // 再起動を模して別インスタンスで読む
    const b = new FsStorage({ root });
    expect(await b.head("a/1/thumb.webp")).toEqual({
      contentLength: 3,
      contentType: "image/webp",
      cacheControl: "public, max-age=1",
    });
    expect([...(await b.get("a/1/display.webp"))!]).toEqual([4]);
    expect(await b.list("a/1/")).toEqual(["a/1/display.webp", "a/1/thumb.webp"]);
  });

  it("returns null for a missing object", async () => {
    const s = new FsStorage({ root });
    expect(await s.head("nope")).toBeNull();
    expect(await s.get("nope")).toBeNull();
  });

  it("deletes objects and ignores missing keys", async () => {
    const s = new FsStorage({ root });
    await s.put({ key: "d/1", body: new Uint8Array([1]), contentType: "a/b" });
    await s.put({ key: "d/2", body: new Uint8Array([2]), contentType: "a/b" });
    await s.delete(["d/1", "nope"]);
    expect(await s.list("d/")).toEqual(["d/2"]);
  });

  it("points the presign at the public url", async () => {
    const s = new FsStorage({ root, publicBaseUrl: "http://localhost:3000/_storage/" });
    const p = await s.presignPut({
      key: "tmp/u2",
      contentType: "image/png",
      contentLength: 1,
      expiresIn: 60,
    });
    expect(p.url).toBe("http://localhost:3000/_storage/tmp/u2");
  });

  it("rejects a key that escapes the root", async () => {
    const s = new FsStorage({ root });
    await expect(s.get("../etc/passwd")).resolves.toBeNull();
    await expect(
      s.put({ key: "../x", body: new Uint8Array(), contentType: "a/b" }),
    ).rejects.toThrow("invalid key");
  });
});
