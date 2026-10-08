# ADR-0006: アカウント状態の検証と永続的な適用を分ける

| 項目     | 内容       |
| -------- | ---------- |
| Status   | Accepted   |
| Date     | 2026-10-07 |
| Deciders | t1nyb0x    |

## Context

accounts の A1.4 は退会・復旧・物理削除を、サービス停止中でも送り直す。各 RP は異なるデータと画像、セッションを持つため、共通ライブラリは DB を知らずに署名と通知の形を確認する必要がある。

## Decision

`auth-client` に専用 JWT の検証器、HTTP handler、`AccountEventAdapter.applyOnce` を追加する。固定された issuer / JWKS と audience、EdDSA、専用 typ、120 秒の有効期間、サービス名、増加する revision、状態と復旧期限を検証する。送信待ちの通知が古くても JWT は試行ごとに新しく署名する。

DB アダプターは必須。eventId とサービスごとの最終 revision、状態変更、セッション失効、画像削除の投入を同じ DB トランザクションで確定する。重複と古い状態は成功として応答する。画像は復旧で戻さず、期限切れのローカルデータは RP のログイン時にも削除する。ローカルの role、ban、規約同意はサービスが持ち続ける。

OIDC ログインは ID トークンの検証後、同じ issuer の UserInfo に access token を渡し、最新の active 状態と一致する sub を確認する。取得が失敗すれば session を作らない。検証済み ID トークンと sid は従来どおり logout 用に保持し、プロフィールと callback の claim は UserInfo の最新の値を使う。

## Consequences

サービスの DB やキューに依存せず受信の共通部分を提供できる。通知の配送と実際のデータ削除の完了は別で、各 RP の永続的なジョブと監視が必要。ログイン時の UserInfo が追加の通信になるため、accounts が応答できないと新規ログインも停止する。

## References

- [auth-client の使い方](../../packages/auth-client/README.md)
- accounts ADR-0008 と退会 runbook、[ADR-0005](0005-auth-client-boundary.md)
