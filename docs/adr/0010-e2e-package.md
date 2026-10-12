# ADR-0010: E2E の土台を @lumorphia/e2e にし、偽の発行元は auth-client で確かめる

| 項目     | 内容       |
| -------- | ---------- |
| Status   | Accepted   |
| Date     | 2026-10-12 |
| Deciders | t1nyb0x    |

## Context

ADR-0009 は「E2E の土台は Scenote の骨組みと一緒に切り出す」とした。Scenote の骨組み (scenote ADR-0008) の時点で共有できたのは、CSP の違反を見張る fixture、hydration を待つ helper、開発の証明書のスクリプトで、どれも数十行だった。切り出す価値が大きいのは、prismtone の `e2e/mock-lumorphia.ts` (Lumorphia アカウントの発行元のふり) と `e2e/tls.ts` (E2E 専用の CA) で、Scenote がこれを使うのはログインの段 (S4) になる。scenote ADR-0008 で、切り出しを S4 に回した。

偽の発行元は、サービスの E2E が本物の accounts と同じ形で通るためのもの。prismtone の版は、本物の accounts とつないで初めて「ID トークンに email が入らない」ことが分かり、偽物も直した (platform#24)。偽物が auth-client や accounts とずれても、偽物を相手にした E2E は緑のまま通る。

## Decision

- `@lumorphia/e2e` を作り、入口を 3 つに分ける
  - `./tls`: E2E 専用の CA と 127.0.0.1・localhost の証明書 (`ensureE2eTls`)、Chromium に証明書を信頼させる公開鍵のハッシュ (`certificateSpki`)
  - `./mock-issuer`: 発行元のふり (`startMockIssuer`)。discovery・JWKS・token・UserInfo、accounts の `/api/characters`、サービスが足す API (`extraRoutes`。prismtone の引き継ぎの完了など)。テストからの操作で、認可の code、back-channel logout、退会の知らせ (送り直しを含む) を出す。bin の `lumorphia-mock-issuer` は環境変数で起動し、Playwright の webServer から使う
  - `./playwright`: CSP の違反を見張る `test`、認可画面のふり (`approveLumorphia`)、back-channel logout と退会の知らせを送る helper、`lumorphiaUser`
- **偽の発行元が出すものは、auth-client そのもので確かめる** (`getUserInfo`、`createLogoutTokenVerifier`、`createAccountEventVerifier`)。auth-client を変えて偽物とずれたら、このリポジトリのテストが落ちる
- **偽の発行元のコードは auth-client を import しない** (ESLint が止める)。同じ実装からトークンを作ると、ずれをテストで見つけられない。auth-client はテストからだけ使う
- サービスごとの偽物 (Discord・Google の OAuth、Misskey、Mastodon、Lodestone) は切り出さない。使うのは accounts と prismtone の旧ログインだけで、Scenote は使わない
- 開発の証明書 (`*.lumorphia.test`、各サービスの `scripts/dev-certs.sh`) も切り出さない。シェルの数十行で、Caddy の compose と一緒に読むほうが分かりやすい
- Scenote から使い始める。prismtone と accounts の載せ替えは、それぞれの都合で行う

## Consequences

### 良い点

- 偽の発行元が 1 つになり、auth-client と食い違わないことを CI が確かめる
- Facetia は、`startMockIssuer` と `approveLumorphia` を並べるだけでログインの E2E を始められる

### 悪い点・受け入れるリスク

- 本物の accounts とのずれ (auth-client が確かめていないもの) は残る。気づいたら偽物と auth-client の両方を直す
- E2E の土台の変更でも版を上げることになる。サービスは devDependencies に固定して入れる

### 追従して必要になること

- prismtone と accounts の `e2e/mock-lumorphia.ts`・`e2e/tls.ts` を載せ替える (それぞれの PR で)
- ADR-0009 の E2E の土台の行は、この ADR で置き換える

## Alternatives

- prismtone の偽物をそのまま写す: 引き継ぎなど prismtone だけの口が混ざり、3 つ目の写しになる
- 本物の accounts を E2E で立てる: accounts の DB とビルドが要り、サービスの E2E が重くなる。偽物を auth-client で確かめるほうが軽い

## References

- ADR-0005、ADR-0006、ADR-0009
- lumorphia/scenote ADR-0008
- lumorphia/prismtone `e2e/mock-lumorphia.ts`、`e2e/tls.ts`、`e2e/lumorphia.ts`
