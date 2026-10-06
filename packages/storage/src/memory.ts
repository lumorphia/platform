import type { ObjectStorage, PresignPutInput, PresignedPut, PutInput } from "./types.ts";

/**
 * テスト・開発用のメモリ実装。
 * publicBaseUrl を与えると presign はその配下の URL を返し、サービスの開発用ルート (prismtone は /_storage) が PUT/GET を受ける。
 * 与えなければ擬似 URL を返し、テストが直接 put() を呼ぶ。
 */
export class MemoryStorage implements ObjectStorage {
  readonly objects = new Map<
    string,
    { body: Uint8Array; contentType: string; cacheControl?: string }
  >();
  readonly presigned: PresignPutInput[] = [];
  readonly publicBaseUrl: string | null;

  constructor(options: { publicBaseUrl?: string } = {}) {
    this.publicBaseUrl = options.publicBaseUrl?.replace(/\/$/, "") ?? null;
  }

  async presignPut(input: PresignPutInput): Promise<PresignedPut> {
    this.presigned.push(input);
    return {
      url: this.publicBaseUrl
        ? `${this.publicBaseUrl}/${input.key}`
        : `memory://bucket/${input.key}?expires=${input.expiresIn}`,
      method: "PUT",
      headers: { "content-type": input.contentType, "content-length": String(input.contentLength) },
      expiresAt: new Date(Date.now() + input.expiresIn * 1000),
    };
  }

  async head(key: string) {
    const o = this.objects.get(key);
    return o
      ? {
          contentLength: o.body.byteLength,
          contentType: o.contentType,
          cacheControl: o.cacheControl ?? null,
        }
      : null;
  }

  async get(key: string) {
    return this.objects.get(key)?.body ?? null;
  }

  async put({ key, body, contentType, cacheControl }: PutInput) {
    this.objects.set(
      key,
      cacheControl ? { body, contentType, cacheControl } : { body, contentType },
    );
  }

  async delete(keys: readonly string[]) {
    for (const k of keys) this.objects.delete(k);
  }

  async list(prefix: string) {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
}
