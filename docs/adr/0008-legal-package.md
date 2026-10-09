# ADR-0008: 規約の本文と同意の版の比較を @lumorphia/legal にまとめる

| 項目     | 内容       |
| -------- | ---------- |
| Status   | Accepted   |
| Date     | 2026-10-09 |
| Deciders | t1nyb0x    |

## Context

lumorphia/scenote の ADR-0006 で、規約の同意まわりを `@lumorphia/legal` に切り出すと決めた (順番の 5 番目)。Prismtone は規約・プライバシーポリシーの版を本文の frontmatter に書き、同意した版を 1 列 (`"terms=1.0;privacy=1.0"`) に保存し、メジャー番号が上がったら再同意を求める。本文は marked で HTML にし、生の HTML は通さない。accounts は版をコードの定数に持ち、同意した版を 2 列に保存し、再同意はまだ無い。

## Decision

- `@lumorphia/legal` に、本文の frontmatter の読み取り (`parseLegalDocument`)、Markdown の HTML 化 (`renderLegalMarkdown`、生の HTML はエスケープ)、改定日の表記 (`formatUpdatedAt`)、同意した版と今の版の比較 (`needsReconsent`、メジャー番号が違えば再同意) を置く
- `needsReconsent` は同意した版を組 (`{ terms, privacy }` か `null`) で受け取る。記録の形はサービスが決める。Prismtone の 1 列の形は `formatConsentVersion` / `parseConsentVersion` で読み書きする
- 画面でも本文を表示するので、ブラウザで動く形に保つ (Node API を使わない。ESLint で縛る)。ファイルの読み込みはサービスが行う
- 表と同意の記録 (列) はサービスが持つ。本文そのもの (規約の中身) もサービスごとに持つ

## Consequences

Prismtone と Scenote は同じ版の決まりと表示を使える。accounts は、再同意を作るときにこのパッケージに載せ替える。

## References

- lumorphia/scenote ADR-0006、lumorphia/prismtone RM-20・RM-32
