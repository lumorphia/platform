/**
 * オブジェクトストレージの境界 (lumorphia/prismtone の ADR-0006、docs/design/03 から移した)。
 * 実装は S3 互換 (Cloudflare R2、ローカルは RustFS)、開発用のファイル実装、テスト用のメモリ実装。
 * キーの付け方 (tmp/、posts/ など) はサービスが決める。ここは知らない
 */
export type PresignPutInput = {
  key: string;
  contentType: string;
  contentLength: number;
  /** 秒 */
  expiresIn: number;
};

export type PresignedPut = {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: Date;
};

export type ObjectMeta = {
  contentLength: number;
  contentType: string | null;
  cacheControl: string | null;
};

export type PutInput = {
  key: string;
  body: Uint8Array;
  contentType: string;
  cacheControl?: string;
};

export interface ObjectStorage {
  presignPut(input: PresignPutInput): Promise<PresignedPut>;
  head(key: string): Promise<ObjectMeta | null>;
  get(key: string): Promise<Uint8Array | null>;
  put(input: PutInput): Promise<void>;
  delete(keys: readonly string[]): Promise<void>;
  list(prefix: string): Promise<string[]>;
}
