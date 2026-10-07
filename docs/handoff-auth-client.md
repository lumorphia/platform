# 引き継ぎ: A1.2 のサービス側の受け口

2026-10-07。accounts の PR #6〜#9 は develop に取り込み済み。platform の `feat/auth-client` で `@lumorphia/auth-client` を追加した。

## 実装した範囲

- Better Auth 1.7.7 の generic-oauth の設定。PKCE・署名と nonce・固定の issuer / audience / EdDSA の検証、ID トークンが無いときの拒否。
- namespaced claim の形の検証。`sub` / `handle` / `legacyPending` と、scope を要求した場合だけ `identities`。
- 要求ごとの検証済みログイン情報の hook。サービスの DB hook で読み取り専用の subject と RP セッションごとの IdP sid / ID トークンを保存する接続例。
- 現在のセッションの hint と state を使う end-session URL。
- back-channel Logout Token の検証と Request / Response の受け口。冪等なセッション削除はサービスのトランザクションで行うアダプター。
- 独立した版での公開設定、依存の向き、ADR-0005 と接続手順。

## 次の作業

1. CI が緑になった PR を develop に **Rebase and merge**。
2. accounts の計画に従い **A1.3: キャラクターと Lodestone の確認・再同期・サービス向けの一覧 API** に進む。
3. A1.4 で退会の署名付き通知の受け口を auth-client に足す。back-channel logout と再送の仕組みを共用しない。
4. A2 (Prismtone) / A3 (Scenote) で利用側の DB schema・要求の context・hook・logout アダプターを実装し、accounts の実 DB・ブラウザと結合する。共通パッケージの結合テストは Better Auth 本体と署名付き JWT を使い、発行元の HTTP 応答だけを差し替えている。

パッケージを足した develop → main の manifest のコンフリクトは [AGENTS.md](../AGENTS.md) の release ブランチの手順で解決する。main の既存の版を0.0.0に戻さない。

接続の詳細は [auth-client README](../packages/auth-client/README.md)、判断は [ADR-0005](adr/0005-auth-client-boundary.md)。
