# ADR-0002: public の monorepo に置き、パッケージごとの版で公開する

| 項目     | 内容       |
| -------- | ---------- |
| Status   | Accepted   |
| Date     | 2026-10-06 |
| Deciders | t1nyb0x    |

## Context

lumorphia/scenote の ADR-0006 で、サービスの領域に属さない基盤を共通パッケージにすると決めた。置き場所について、次の制約があった。

- org の GitHub Actions は Free プランで、private リポジトリは月 2000 分まで。Prismtone だけでも重い。public リポジトリの標準のランナーは上限が無い
- モデレーションの判定のように、知られると回避されるものがある
- ほかの人が持っていって、手を入れた部分を隠して使うことは避けたい

## Decision

- **このリポジトリは public**。知られると回避されるもの (モデレーションの判定、今後の不正対策) は private の lumorphia/umbra に置き、向きは umbra -> platform だけにする。署名付き URL や画像の検証は、安全が鍵と正しい実装で守られていて、コードを隠しても強くならないので、ここに置く
- **ライセンスは AGPL-3.0-only** (lumorphia/editor と同じ)。著作権者は運営者だけなので、private の Prismtone・Scenote が使っても運営者は縛られない。外からの貢献を受け入れる前に CLA を用意する
- **1 つの monorepo にまとめ、パッケージごとに版を付ける** (release-please の manifest)。疎結合はリポジトリの境界ではなく、パッケージの境界と依存の向きで守る (ESLint、`tooling/eslint-boundaries.test.ts`)
- GitHub Packages に公開する。サービスは使うパッケージだけを、版を固定して入れる
- **入れてよいデータ**: クレデンシャルは入れない (gitleaks)。運営者以外の人のデータは入れない。テストの画像はテストの中で作り、スクリーンショットや学習データを入れない

## Consequences

### 良い点

- CI の時間が org の上限を使わない。PR のたびに S3 互換の結合テスト (RustFS) まで回せる
- Dependabot や CodeQL を無料で使える

### 悪い点・受け入れるリスク

- public なので、うっかりの混入がそのまま公開になる。pre-commit と CI の gitleaks、AGENTS.md の約束で防ぐ
- GitHub Packages は public のパッケージでも install に認証が要る。サービスの CI・Docker のビルド・Renovate にトークンを渡す

## Alternatives

- 全部を 1 つの private リポジトリに置く: CI のすべてが org の 2000 分を食う
- パッケージごとにリポジトリを分ける: CI・Renovate・release-please の設定が増え、複数のパッケージにまたがる変更が複数の PR になる。1 人で保守するには面が多すぎる
- lumorphia/editor と同じ monorepo に入れる: editor には単独アプリという別の利用者がいて、出す速さも違う

## References

- lumorphia/scenote ADR-0006
- lumorphia/editor ADR-0007
