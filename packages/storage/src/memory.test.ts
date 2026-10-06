import { describe, expect, it } from "vitest";
import { MemoryStorage } from "./memory.ts";

describe("MemoryStorage", () => {
  it("stores, reads and lists objects in key order", async () => {
    const s = new MemoryStorage();
    await s.put({ key: "b/2", body: new Uint8Array([2]), contentType: "image/webp" });
    await s.put({
      key: "b/1",
      body: new Uint8Array([1, 1]),
      contentType: "image/webp",
      cacheControl: "no-store",
    });
    expect(await s.head("b/1")).toEqual({
      contentLength: 2,
      contentType: "image/webp",
      cacheControl: "no-store",
    });
    expect(await s.head("b/2")).toMatchObject({ cacheControl: null });
    expect([...(await s.get("b/2"))!]).toEqual([2]);
    expect(await s.list("b/")).toEqual(["b/1", "b/2"]);
  });

  it("returns null for a missing object", async () => {
    const s = new MemoryStorage();
    expect(await s.head("nope")).toBeNull();
    expect(await s.get("nope")).toBeNull();
  });

  it("deletes objects", async () => {
    const s = new MemoryStorage();
    await s.put({ key: "x", body: new Uint8Array(), contentType: "a/b" });
    await s.delete(["x", "nope"]);
    expect(await s.list("")).toEqual([]);
  });

  it("records presign requests and signs nothing without a public url", async () => {
    const s = new MemoryStorage();
    const input = { key: "tmp/1", contentType: "image/png", contentLength: 3, expiresIn: 10 };
    const p = await s.presignPut(input);
    expect(p.url).toBe("memory://bucket/tmp/1?expires=10");
    expect(p.headers).toEqual({ "content-type": "image/png", "content-length": "3" });
    expect(s.presigned).toEqual([input]);
  });
});
