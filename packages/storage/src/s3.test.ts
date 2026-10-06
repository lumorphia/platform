import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { S3Storage } from "./s3.ts";

describe("S3Storage presign", () => {
  // 署名だけならサーバーは要らない (URL を作るだけで通信しない)
  const storage = new S3Storage({
    endpoint: "https://example.r2.cloudflarestorage.com",
    bucket: "bucket",
    accessKeyId: "test-access-key",
    secretAccessKey: "test-secret-key",
  });

  it("signs the content type and length so a different upload is refused", async () => {
    const p = await storage.presignPut({
      key: "tmp/abc",
      contentType: "image/webp",
      contentLength: 1234,
      expiresIn: 300,
    });
    const signed = new URL(p.url).searchParams.get("X-Amz-SignedHeaders")?.split(";") ?? [];
    expect(signed).toEqual(expect.arrayContaining(["content-length", "content-type", "host"]));
    expect(p.headers).toEqual({ "content-type": "image/webp", "content-length": "1234" });
  });

  it("limits the URL to the requested lifetime", async () => {
    const p = await storage.presignPut({
      key: "tmp/abc",
      contentType: "image/png",
      contentLength: 1,
      expiresIn: 300,
    });
    expect(new URL(p.url).searchParams.get("X-Amz-Expires")).toBe("300");
    expect(p.method).toBe("PUT");
  });
});

// S3 互換のサーバー (RustFS) に対する結合テスト。CI は RustFS を立てて S3_TEST_ENDPOINT を渡す。
// 手元では `docker run` で立てたときだけ走る。CI で接続先が無いときは skip で緑にせず落とす
const endpoint = process.env.S3_TEST_ENDPOINT;

describe("S3 integration settings", () => {
  it("has an S3 endpoint when running in CI", () => {
    if (process.env.CI) expect(endpoint, "CI では S3_TEST_ENDPOINT が要る").toBeTruthy();
  });
});

describe.skipIf(!endpoint)("S3Storage against an S3-compatible server", () => {
  const bucket = process.env.S3_TEST_BUCKET ?? "platform-test";
  const credentials = {
    accessKeyId: process.env.S3_TEST_ACCESS_KEY_ID ?? "platform",
    secretAccessKey: process.env.S3_TEST_SECRET_ACCESS_KEY ?? "platform-test-secret",
  };
  const storage = new S3Storage({
    endpoint: endpoint!,
    region: "us-east-1",
    bucket,
    ...credentials,
    forcePathStyle: true,
  });
  const prefix = `run-${Date.now()}/`;

  beforeAll(async () => {
    const admin = new S3Client({
      endpoint: endpoint!,
      region: "us-east-1",
      credentials,
      forcePathStyle: true,
    });
    await waitUntilReady(() => admin.send(new CreateBucketCommand({ Bucket: bucket })));
  }, 30_000);

  afterAll(async () => {
    await storage.delete(await storage.list(prefix));
  });

  it("puts, reads and lists objects", async () => {
    await storage.put({
      key: `${prefix}a.webp`,
      body: new Uint8Array([1, 2, 3]),
      contentType: "image/webp",
      cacheControl: "public, max-age=60",
    });
    expect(await storage.head(`${prefix}a.webp`)).toEqual({
      contentLength: 3,
      contentType: "image/webp",
      cacheControl: "public, max-age=60",
    });
    expect([...(await storage.get(`${prefix}a.webp`))!]).toEqual([1, 2, 3]);
    expect(await storage.list(prefix)).toEqual([`${prefix}a.webp`]);
  });

  it("returns null for a missing object", async () => {
    expect(await storage.head(`${prefix}missing`)).toBeNull();
    expect(await storage.get(`${prefix}missing`)).toBeNull();
  });

  it("accepts a presigned PUT with the declared type and length", async () => {
    const body = new Uint8Array([9, 8, 7, 6]);
    const p = await storage.presignPut({
      key: `${prefix}up.png`,
      contentType: "image/png",
      contentLength: body.byteLength,
      expiresIn: 60,
    });
    const res = await fetch(p.url, { method: p.method, headers: p.headers, body });
    expect(res.status).toBe(200);
    expect(await storage.head(`${prefix}up.png`)).toMatchObject({
      contentLength: 4,
      contentType: "image/png",
    });
  });

  it("refuses a presigned PUT with a different content type", async () => {
    const body = new Uint8Array([1, 2]);
    const p = await storage.presignPut({
      key: `${prefix}typed.png`,
      contentType: "image/png",
      contentLength: body.byteLength,
      expiresIn: 60,
    });
    const res = await fetch(p.url, {
      method: p.method,
      headers: { ...p.headers, "content-type": "text/html" },
      body,
    });
    expect(res.status).toBe(403);
    expect(await storage.head(`${prefix}typed.png`)).toBeNull();
  });

  it("deletes objects in batches", async () => {
    const keys = [`${prefix}d1`, `${prefix}d2`];
    for (const key of keys)
      await storage.put({ key, body: new Uint8Array([1]), contentType: "a/b" });
    await storage.delete(keys);
    expect(await storage.list(`${prefix}d`)).toEqual([]);
  });
});

/** サーバーが立ち上がるまで待ってバケットを作る。すでにあれば (前の実行で作った) そのまま使う */
async function waitUntilReady(createBucket: () => Promise<unknown>): Promise<void> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      await createBucket();
      return;
    } catch (e) {
      const name = (e as { name?: string }).name;
      if (name === "BucketAlreadyOwnedByYou" || name === "BucketAlreadyExists") return;
      if (Date.now() > deadline) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}
