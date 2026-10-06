# ADR-0001: ADR を用いて設計判断を記録する

| 項目     | 内容       |
| -------- | ---------- |
| Status   | Accepted   |
| Date     | 2026-10-06 |
| Deciders | t1nyb0x    |

## Context

lumorphia/platform は複数のサービスが使う基盤で、ここでの判断はすべてのサービスに及ぶ。lumorphia/prismtone、lumorphia/editor、lumorphia/scenote と同じく、判断の理由を残す。

## Decision

設計上の重要な判断は ADR として `docs/adr/` に記録する。

- 形式は `0000-template.md` に従う。ファイル名は `NNNN-kebab-case-title.md`、番号は通し番号
- 一度 Accepted にした ADR は書き換えず、覆す場合は新しい ADR を作り、旧 ADR の Status を `Superseded by ADR-NNNN` にする
- 「重要な判断」の目安: パッケージの境界や公開する API が変わる、サービスに求めることが変わる、外部サービスへの依存が増減する、のいずれか
- prismtone から移したコードの判断は、prismtone の ADR を参照する (コピーしない)

## Consequences

### 良い点

- サービスの側から、基盤の判断の理由を追える

### 悪い点・受け入れるリスク

- 記録の手間が増える。上の目安で線を引く

## Alternatives

- 設計の文書や、コミットメッセージだけに残す: 代替案が残らず、検索しにくい

## References

- lumorphia/scenote `docs/adr/0006-shared-platform-packages.md`
