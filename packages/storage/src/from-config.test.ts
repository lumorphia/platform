import { describe, expect, it } from "vitest";
import { createStorage, storageConfigFromEnv } from "./from-config.ts";
import { FsStorage } from "./fs.ts";
import { MemoryStorage } from "./memory.ts";
import { S3Storage } from "./s3.ts";

describe("storageConfigFromEnv", () => {
  it("defaults to s3 and derives the R2 endpoint from the account id", () => {
    const c = storageConfigFromEnv({
      R2_ACCOUNT_ID: "abc",
      R2_ACCESS_KEY_ID: "k",
      R2_SECRET_ACCESS_KEY: "s",
      R2_BUCKET: "b",
    });
    expect(c).toEqual({
      driver: "s3",
      endpoint: "https://abc.r2.cloudflarestorage.com",
      bucket: "b",
      accessKeyId: "k",
      secretAccessKey: "s",
      forcePathStyle: false,
    });
  });
  it("prefers an explicit endpoint and parses path style", () => {
    const c = storageConfigFromEnv({
      STORAGE_ENDPOINT: "http://127.0.0.1:9000",
      STORAGE_FORCE_PATH_STYLE: "true",
      R2_ACCESS_KEY_ID: "k",
      R2_SECRET_ACCESS_KEY: "s",
      R2_BUCKET: "b",
    });
    expect(c).toMatchObject({ endpoint: "http://127.0.0.1:9000", forcePathStyle: true });
  });
  it("throws when s3 settings are incomplete", () => {
    expect(() => storageConfigFromEnv({ R2_BUCKET: "b" })).toThrow(/required/);
  });
  it("reads the memory driver with and without a public url", () => {
    expect(storageConfigFromEnv({ STORAGE_DRIVER: "memory" })).toEqual({ driver: "memory" });
    expect(
      storageConfigFromEnv({
        STORAGE_DRIVER: "memory",
        STORAGE_MEMORY_PUBLIC_URL: "http://x/_storage",
      }),
    ).toEqual({ driver: "memory", publicBaseUrl: "http://x/_storage" });
  });
  it("reads the fs driver with its default root", () => {
    expect(storageConfigFromEnv({ STORAGE_DRIVER: "fs" })).toEqual({
      driver: "fs",
      root: ".data/storage",
    });
    expect(
      storageConfigFromEnv({
        STORAGE_DRIVER: "fs",
        STORAGE_FS_ROOT: "/var/data",
        STORAGE_MEMORY_PUBLIC_URL: "http://x/_storage",
      }),
    ).toEqual({ driver: "fs", root: "/var/data", publicBaseUrl: "http://x/_storage" });
  });
});

describe("createStorage", () => {
  it("builds the matching implementation", () => {
    expect(createStorage({ driver: "memory" })).toBeInstanceOf(MemoryStorage);
    expect(
      createStorage({
        driver: "s3",
        endpoint: "http://x",
        bucket: "b",
        accessKeyId: "k",
        secretAccessKey: "s",
      }),
    ).toBeInstanceOf(S3Storage);
    expect(createStorage({ driver: "fs", root: "/tmp/x" })).toBeInstanceOf(FsStorage);
  });
  it("points the memory presign at the public url when configured", async () => {
    const m = createStorage({
      driver: "memory",
      publicBaseUrl: "http://x/_storage/",
    }) as MemoryStorage;
    const p = await m.presignPut({
      key: "tmp/1",
      contentType: "image/png",
      contentLength: 3,
      expiresIn: 10,
    });
    expect(p.url).toBe("http://x/_storage/tmp/1");
    expect(p.headers["content-length"]).toBe("3");
  });
});
