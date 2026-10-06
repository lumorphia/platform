import { FsStorage } from "./fs.ts";
import { MemoryStorage } from "./memory.ts";
import { S3Storage } from "./s3.ts";
import type { ObjectStorage } from "./types.ts";

export type StorageConfig =
  | { driver: "memory"; publicBaseUrl?: string }
  | { driver: "fs"; root: string; publicBaseUrl?: string }
  | {
      driver: "s3";
      endpoint: string;
      bucket: string;
      accessKeyId: string;
      secretAccessKey: string;
      forcePathStyle?: boolean;
    };

/** 環境変数から組み立てた設定でストレージ実装を選ぶ。サービスの app と worker で共有する。 */
export function createStorage(config: StorageConfig): ObjectStorage {
  if (config.driver === "memory")
    return new MemoryStorage(config.publicBaseUrl ? { publicBaseUrl: config.publicBaseUrl } : {});
  if (config.driver === "fs")
    return new FsStorage({
      root: config.root,
      ...(config.publicBaseUrl ? { publicBaseUrl: config.publicBaseUrl } : {}),
    });
  return new S3Storage({
    endpoint: config.endpoint,
    bucket: config.bucket,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    forcePathStyle: config.forcePathStyle ?? false,
  });
}

export type StorageEnv = {
  STORAGE_DRIVER?: string | undefined;
  /** memory / fs ドライバ用: ブラウザが PUT/GET する公開 URL (サービスの開発用ルート) */
  STORAGE_MEMORY_PUBLIC_URL?: string | undefined;
  /** fs ドライバの保存先。既定 .data/storage */
  STORAGE_FS_ROOT?: string | undefined;
  STORAGE_ENDPOINT?: string | undefined;
  STORAGE_FORCE_PATH_STYLE?: string | undefined;
  R2_ACCOUNT_ID?: string | undefined;
  R2_ACCESS_KEY_ID?: string | undefined;
  R2_SECRET_ACCESS_KEY?: string | undefined;
  R2_BUCKET?: string | undefined;
};

export function storageConfigFromEnv(env: StorageEnv): StorageConfig {
  const driver = env.STORAGE_DRIVER ?? "s3";
  if (driver === "memory") {
    return env.STORAGE_MEMORY_PUBLIC_URL
      ? { driver: "memory", publicBaseUrl: env.STORAGE_MEMORY_PUBLIC_URL }
      : { driver: "memory" };
  }
  if (driver === "fs") {
    return {
      driver: "fs",
      root: env.STORAGE_FS_ROOT || ".data/storage",
      ...(env.STORAGE_MEMORY_PUBLIC_URL ? { publicBaseUrl: env.STORAGE_MEMORY_PUBLIC_URL } : {}),
    };
  }
  const endpoint =
    env.STORAGE_ENDPOINT ||
    (env.R2_ACCOUNT_ID ? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : "");
  if (!endpoint || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET) {
    throw new Error(
      "storage: STORAGE_ENDPOINT (or R2_ACCOUNT_ID), R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET are required",
    );
  }
  return {
    driver: "s3",
    endpoint,
    bucket: env.R2_BUCKET,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    forcePathStyle: env.STORAGE_FORCE_PATH_STYLE === "true" || env.STORAGE_FORCE_PATH_STYLE === "1",
  };
}
