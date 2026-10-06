# AGENTS.md

lumorphia/platform: Lumorphia のサービス (Prismtone、Scenote、今後の Facetia) が共通で使う基盤。サービスの領域 (装備、撮影場所、投稿の中身) を知らないものだけを置く。
経緯と範囲は lumorphia/scenote の ADR-0006。このリポジトリは public (AGPL-3.0)。知られると回避されるもの (モデレーションの判定など) は private の lumorphia/umbra に置く。

## 構成

```
packages/media    @lumorphia/media    画像の検証、メタデータの除去、派生画像とアイコン (sharp)
packages/storage  @lumorphia/storage  オブジェクトストレージの境界と実装 (S3 互換、ファイル、メモリ)、署名付き URL
packages/ops      @lumorphia/ops      運用の土台。入口は logger (pino、Node 専用)、notify (Discord)、sentry (伏せ字、ブラウザでも動く)
tooling/          リポジトリ全体の決まりのテスト (依存の向き、公開する package.json)
docs/adr/         設計判断
```

中身は lumorphia/prismtone の `packages/core/src/adapters/{image,storage,notify}`、`logger.ts`、`packages/shared/src/monitoring/` から移した。本文やコメントの `prismtone ADR-NNNN`、`docs/design/NN` は prismtone のもの。

## 依存の方向 (ESLint が強制する。tooling/eslint-boundaries.test.ts が確かめる)

- どのパッケージもサービス (`@prismtone/*`、`@scenote/*` など) を import しない。サービスの都合は引数やアダプターで受け取る
- どのパッケージも private の umbra (`@lumorphia/moderation`) を import しない。向きは umbra -> platform だけ
- `media` は置き場所を知らない (`storage` と S3 を使わない)。`storage` は中身を知らない (`media` と sharp を使わない)
- `ops` は画像もストレージも知らない。`ops/sentry` はブラウザでも動くので、Node API と pino を使わない
- ほかのパッケージは `package.json` の exports から使う (`/src/` や `/dist/` を直接指さない)
- **パッケージはサービスの DB のテーブルを持たない**。関数とアダプターと型を出す
- キーの付け方 (`tmp/`、`posts/` など) はサービスが決める。`storage` は知らない

## 入れてよいデータ (public リポジトリ)

- クレデンシャル (トークン、鍵、パスワード、`.env`) は入れない。husky の pre-commit と CI が gitleaks で検査する。テストの擬似の値は `test-` などで始める (`.gitleaks.toml`)
- 運営者以外の人のデータは入れない (他のプレイヤーのキャラクター、投稿、スクリーンショット、利用者の ID やメールアドレス)
- テストの画像は、ファイルを置かずにテストの中で sharp で作る。運営者のものでも、スクリーンショットや学習データを入れない

## 作業の流れ

1. `develop` から `feat/<topic>` を切る。`develop` と `main` に直接コミットしない。`main` はリリース用で、`develop` からだけマージする
2. **TDD で進める**。実装より先に、失敗するテストを書く (red) → 通す最小の実装 (green) → 整える (refactor)。新しいテストは、実装前に一度落ちるのを確かめてから通す
3. `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test` を通す。husky が pre-commit で変更ファイルの ESLint / Prettier と gitleaks、pre-push で typecheck と test を回す (`pnpm install` で有効になる)
4. `develop` 向けに PR を作る (`gh pr create --base develop`)。Issue は PR 本文とコミットメッセージに `Closes #N` を書いて閉じる
5. **`develop` へは「Rebase and merge」でマージする**。マージコミットは本文に PR のタイトルが入り、release-please が同じ変更を 2 回数える。`develop` → `main` だけはマージコミット

コミットは `feat:` `fix:` `docs:` `test:` `refactor:` `build:` `ci:` の Conventional Commits、本文は日本語。変更がどのパッケージのものかは、release-please がファイルのパスで決める。1 つのコミットで複数のパッケージを触ると、両方の変更履歴に載る。

## リリース

- パッケージごとに版を付ける (release-please の manifest、`release-please-config.json`)。タグは `media-v1.2.0` の形
- `main` への push で release-please がリリース PR を開き直す。マージすると、版が上がったパッケージだけを CI の release ジョブが GitHub Packages に公開する
- 最初のリリースは 1.0.0 から始まる (`initial-version` を付けていない。manifest の 0.0.0 は前のリリースとみなされない)
- 版の上げ方は Conventional Commits から決まる (`feat:` で minor、`fix:` / `refactor:` / `perf:` で patch、`feat!:` や `BREAKING CHANGE:` で major)。サービスは自分の都合で上げるので、破壊的な変更は必ず major にする
- 同じ版は出し直せない。公開の設定は `tooling/packages.test.ts` が確かめる
- リリース PR は `main` だけで版を上げる (`.release-please-manifest.json`、各パッケージの `package.json` と `CHANGELOG.md`)。`develop` には戻らないので、`develop` の版は 0.0.0 のまま (`tooling/packages.test.ts` は package.json と manifest の一致だけを見る)
- **パッケージを足すと、`develop` → `main` で manifest がコンフリクトする** (`main` で版を上げた行と、`develop` で足した行が隣り合う)。`develop` は履歴を一直線に保つ ruleset があり `main` を取り込めないので、`main` から `release/<topic>` を切って `develop` をマージし、`main` の版を残して足したパッケージを `0.0.0` で加え、`main` へ PR にする (マージコミット)

## テストの書き方

- **1 つの `it` に 1 つの振る舞い**。名前は英語で「何をすると何になる」を言い切る
- **カバレッジは手がかりで、目標ではない**。閾値 (lines / functions / statements 80%、branches 70%) は下限
- テストはパッケージをビルドせずソースから読む (exports の `source` 条件、`vitest.source.ts`)
- `storage` の S3 の結合テストは RustFS を相手にする。手元では立てたときだけ走り、CI (`CI=true`) では接続先が無いと skip ではなく失敗する

```sh
docker run -d --rm --name platform-rustfs-test -p 127.0.0.1:9100:9000 \
  -e RUSTFS_ACCESS_KEY=platform -e RUSTFS_SECRET_KEY=platform-test-secret rustfs/rustfs:1.0.0
S3_TEST_ENDPOINT=http://127.0.0.1:9100 pnpm test
```

## コードの約束

- TypeScript strict、`import type` を使う、`.ts` 拡張子付きで import する
- コメント・ドキュメント・コミットは日本語。絵文字は使わない
- 配列やオブジェクトは変更せず新しく作る
- 設計上の判断を変えるときは ADR を追加する (`docs/adr/`)

## 依存の入れ方

- pnpm 12 は公開から 1 日経っていない版を入れない (`minimumReleaseAge`)。`pnpm-workspace.yaml` で緩めない
- ビルドスクリプトを持つ依存は `pnpm-workspace.yaml` の `allowBuilds` に許可か不許可を書く

## よく使うコマンド

```sh
pnpm test            # 単体テスト (ビルド不要)
pnpm test:coverage   # カバレッジ付き
pnpm typecheck
pnpm lint && pnpm format:check
pnpm build:packages  # 各パッケージを dist に
```
