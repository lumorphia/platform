# ADR-0003: 署名付き PUT の URL に content-type を署名する

| 項目     | 内容       |
| -------- | ---------- |
| Status   | Accepted   |
| Date     | 2026-10-06 |
| Deciders | t1nyb0x    |

## Context

lumorphia/prismtone の ADR-0006 は「`ContentType` と `ContentLength` を署名に含め、申告と異なる PUT を拒否させる」と決め、`S3Storage.presignPut` もそのつもりで `PutObjectCommand` に両方を渡していた。

platform に移すときにテストを書くと、署名されているのは `content-length` と `host` だけで、`content-type` は署名されていなかった。

- `@aws-sdk/s3-request-presigner` は、`prepareRequest` で `content-type` を必ず「署名しないヘッダー」(`unsignableHeaders`) に入れる (3.1146.0 の `dist-cjs/index.js`)
- 実際に RustFS で、`image/png` で発行した URL に `text/html` で PUT すると 200 で受け入れた

Prismtone の本番では、公開ドメインの WAF が `/posts/` 以外を拒否し (prismtone の docs/design/03)、worker が先頭のバイトで形式を判定して作り直すので、`tmp/` に置かれたものがそのまま配信されることはない。それでも、多重の守りの 1 枚が最初から欠けていた。

## Decision

`getSignedUrl` に `signableHeaders: new Set(["content-type"])` を渡す。署名器 (`@smithy/signature-v4` の `getCanonicalHeaders`) は、署名しないヘッダーの一覧より `signableHeaders` を優先して署名する。

- 単体テスト: URL の `X-Amz-SignedHeaders` に `content-type` と `content-length` が入っていること
- 結合テスト (RustFS): 申告と違う `content-type` の PUT が 403 になり、オブジェクトが作られないこと。直す前のコードでは 200 になることを確かめた

## Consequences

### 良い点

- 申告と違う種類のファイルを、署名付き URL で置けなくなる

### 悪い点・受け入れるリスク

- ブラウザは、URL と一緒に返す `headers` の `content-type` を、そのまま付けて PUT しなければならない。Prismtone はそうしている
- AWS SDK が内部の振る舞いを変えると、また署名から外れうる。単体テストが落ちて気づける

### 追従して必要になること

- Prismtone を `@lumorphia/storage` に載せ替えると、この修正が入る
- 確かめたのは RustFS だけ。Prismtone の載せ替えのときに、本番の R2 でも違う `content-type` の PUT が拒否されることと、正しい PUT が通ることを確かめる

## Alternatives

- presigned POST (ポリシーで `Content-Type` を縛る): R2 が対応しているかは確かめていない。PUT の署名で足りるので比べなかった
- 何もしない (WAF と worker の判定に任せる): 守りが 1 枚少ないまま

## References

- lumorphia/prismtone ADR-0006、docs/design/03-image-pipeline.md
- `packages/storage/src/s3.ts`、`packages/storage/src/s3.test.ts`

## 追記 (2026-10-06): 本番の R2 で確かめた

lumorphia/prismtone v1.11.3 (`@lumorphia/storage` 1.0.0) を本番に入れたあと、Cloudflare R2 で確かめた。

- `X-Amz-SignedHeaders` は `content-length;content-type;host`
- `image/png` で発行した URL に `text/html` で PUT すると 403、`image/png` で PUT すると 200
- 画面からの普通の投稿 (ブラウザが発行時の `headers` を付けて PUT する) は通る
