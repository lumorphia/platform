# lumorphia/platform

Lumorphia のサービス (Prismtone、Scenote) が共通で使う基盤のパッケージ。

| パッケージ           | 中身                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `@lumorphia/media`   | 画像の検証 (形式、MIME、デコード、画素数)、メタデータの除去、表示用・サムネイル・アイコンの生成 |
| `@lumorphia/storage` | オブジェクトストレージの境界と、S3 互換 (Cloudflare R2、RustFS)・ファイル・メモリの実装         |

GitHub Packages に、パッケージごとの版で公開している。読むには `read:packages` のトークンが要る。

```ini
# .npmrc
@lumorphia:registry=https://npm.pkg.github.com
```

開発の手順は [AGENTS.md](AGENTS.md)。

## ライセンス

[AGPL-3.0-only](LICENSE)
