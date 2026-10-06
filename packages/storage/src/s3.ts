import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ObjectStorage, PresignPutInput, PresignedPut, PutInput } from "./types.ts";

export type S3StorageConfig = {
  endpoint: string;
  region?: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** RustFS などパススタイルが必要な場合 */
  forcePathStyle?: boolean;
};

/** Cloudflare R2 / RustFS 向けの S3 互換実装 (lumorphia/prismtone の ADR-0006、ADR-0026)。 */
export class S3Storage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3StorageConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region ?? "auto",
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      forcePathStyle: config.forcePathStyle ?? false,
    });
  }

  async presignPut(input: PresignPutInput): Promise<PresignedPut> {
    // ContentType と ContentLength を署名に含め、申告と異なる PUT を拒否させる (lumorphia/prismtone の docs/design/03 §3.1)。
    // presigner は content-type を必ず「署名しないヘッダー」に入れる (@aws-sdk/s3-request-presigner の prepareRequest)。
    // signableHeaders に入れると、署名器 (@smithy/signature-v4 の getCanonicalHeaders) がそちらを優先して署名する
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.contentLength,
    });
    const url = await getSignedUrl(this.client, cmd, {
      expiresIn: input.expiresIn,
      signableHeaders: new Set(["content-type"]),
    });
    return {
      url,
      method: "PUT",
      headers: { "content-type": input.contentType, "content-length": String(input.contentLength) },
      expiresAt: new Date(Date.now() + input.expiresIn * 1000),
    };
  }

  async head(key: string) {
    try {
      const r = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return {
        contentLength: r.ContentLength ?? 0,
        contentType: r.ContentType ?? null,
        cacheControl: r.CacheControl ?? null,
      };
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  async get(key: string) {
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return r.Body ? await r.Body.transformToByteArray() : null;
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  async put({ key, body, contentType, cacheControl }: PutInput) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: cacheControl,
      }),
    );
  }

  async delete(keys: readonly string[]) {
    for (let i = 0; i < keys.length; i += 1000) {
      const chunk = keys.slice(i, i + 1000);
      if (chunk.length === 0) return;
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
        }),
      );
    }
  }

  async list(prefix: string) {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const r = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const o of r.Contents ?? []) if (o.Key) keys.push(o.Key);
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }
}

function isNotFound(e: unknown): boolean {
  const name = (e as { name?: string }).name;
  const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return name === "NotFound" || name === "NoSuchKey" || status === 404;
}
