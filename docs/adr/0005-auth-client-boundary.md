# ADR-0005: サービス側の OIDC の受け口を auth-client にまとめる

| 項目     | 内容       |
| -------- | ---------- |
| Status   | Accepted   |
| Date     | 2026-10-07 |
| Deciders | t1nyb0x    |

## Context

accounts の ADR-0003 と A1.2 で、サービスは Better Auth の generic-oauth を使うと決めた。発行元の実装・署名鍵の更新・end-session / back-channel logout が揃った。サービスごとに署名や claim の検証を複製すると、安全性と更新の判断が分かれる。一方、ユーザーの引き継ぎとセッションのテーブルはサービスごとに異なる。

## Decision

- `@lumorphia/auth-client` を platform の独立したパッケージとして公開する。Better Auth の互換版は accounts と同じ1.7.7に固定し、利用側の peer dependency とする。実行時の JWT 検証は jose 6.2.12。サービス・media・storage・ops・umbra の実装に依存しない。
- `genericOAuth` の設定を出す。PKCE と ID トークンの署名・nonce の検証を必須にし、さらに設定した issuer・client audience・EdDSA を固定した JWKS 検証を行う。ID トークンの無い応答には UserInfo による fallback をしない。
- カスタム claim の形を検証して `sub` / `handle` / `legacyPending` / 任意の `identities` を返す。サービスの role、ban、bio、同意状態は取り込まない。identity の scope を要求した場合だけ identities を返す。
- 検証済みのログイン情報を要求の context に渡す hook を出す。サービスは自分の DB hook で `users.lumorphia_sub` と RP セッションの IdP `sid` / ID トークンを保存する。Better Auth は `input: false` の項目を provider profile から保存しないため、書き込みはサーバーの hook に限る。メールによる自動連携はサービスの設定で無効にする。
- Better Auth の account 行の ID トークンは別のログインで更新される。自動 provider logout を無効にし、現在の RP セッションに保存した hint を使う end-session URL を作る。サービスが CSRF と戻り先 state を検証する。
- back-channel の受け口は標準 Request / Response。Logout Token は固定の JWKS・署名方式・issuer・audience・typ・event・時刻・nonce の不在を検証し、Lumorphia の `sub` と `sid` を両方要求する。受信フォームは16 KiBまで。
- セッションの削除と `jti` による冪等性はサービスのアダプターで同じトランザクションにする。検証済みの issuer / clientId / sub / sid に一致するセッションだけを消す。サービスの DB テーブルは platform に作らない。

## Consequences

安全性の判断と HTTP の受け口を共通化し、サービスのデータモデルを独立させられる。利用側は DB schema、要求ごとの context、hook、戻り先の state、冪等な logout アダプターを実装する必要がある。

共通パッケージでは実際の Better Auth の callback と生成した署名付き JWT で結合テストを行う。accounts の実 DB・ブラウザとの接続は各サービスの組み込み時に確認する。退会の通知と再送は A1.4 で別に扱う。

## References

- lumorphia/accounts ADR-0003、docs/handoff-a1-2.md、docs/runbook/oidc.md
- [接続手順](../../packages/auth-client/README.md)
- [ADR-0002](0002-repository-scope-and-publishing.md)
