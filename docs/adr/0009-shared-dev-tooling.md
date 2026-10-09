# ADR-0009: 開発の道具は Renovate の共通の設定と CI の再利用ワークフローだけを共通にする

| 項目     | 内容       |
| -------- | ---------- |
| Status   | Accepted   |
| Date     | 2026-10-09 |
| Deciders | t1nyb0x    |

## Context

lumorphia/scenote の ADR-0006 で、開発の道具 (ESLint・TypeScript・Prettier の設定、CI の再利用ワークフロー、Renovate と release-please の設定、E2E の土台) を共通にすると決めた (順番の 6 番目)。5 つのリポジトリ (prismtone、accounts、platform、umbra、editor) を見比べると、Prettier・TypeScript の設定はほぼ同じで数行しかなく、めったに変わらない。CI のアクション・gitleaks・Node の版は揃っているが、上げるたびに 5 か所を直している。Renovate の設定は 4 つが同じで、prismtone だけ独自の決まりが多い。E2E の偽物 (OAuth・Misskey・Mastodon・Lodestone) と開発用の証明書は prismtone から accounts に写され、少しずつずれ始めている。

## Decision

- **Renovate の共通の設定**を `renovate/default.json` に置く。各リポジトリは `"extends": ["local>lumorphia/platform//renovate/default"]` で読み、リポジトリだけの決まり (prismtone の postgres や transformers の上限など) と hostRules を自分の `renovate.json` に足す。Renovate は main の版を読む
- **CI の再利用ワークフロー**を置く。`security.yml` (gitleaks で履歴全体、高リスクの脆弱性は警告、追加の検査) と `release.yml` (release-please と、版が上がったパッケージだけを GitHub Packages に公開。platform と umbra の形)。呼び出し側は `lumorphia/platform/.github/workflows/<名前>.yml@<main の commit> # main` で固定し、Renovate が上げる。lint・テスト・E2E・Docker はリポジトリごとの違いが大きいので共通にしない
- **Prettier・TypeScript・ESLint の基本の設定はパッケージにしない**。数行で、版を上げる手間のほうが大きい。新しいリポジトリは AGENTS.md の「手本」の一覧から写す
- **E2E の土台は、Scenote の骨組みと一緒に切り出す**。3 つ目の使い手が出たときのほうが、共通の形を決めやすい

## Consequences

アクション・gitleaks・Node の版と Renovate の決まりは、platform で 1 回直せば各リポジトリに届く (再利用ワークフローは呼び出し側の固定を Renovate が上げたとき)。platform の main に入るまで、ほかのリポジトリは新しいワークフローと設定を使えない。

再利用ワークフローは public の platform にあり、private のリポジトリ (prismtone、umbra) からも呼べる。中身はシークレットを持たず、呼び出し側の `GITHUB_TOKEN` で動く。

## References

- lumorphia/scenote ADR-0006
