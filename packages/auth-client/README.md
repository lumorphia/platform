# @lumorphia/auth-client

Lumorphia accounts を発行元に使うサービスの、OIDC ログイン・claim・ログアウトの受け口。サーバーで使う。Better Auth は accounts と同じ **1.7.7**、jose は **6.2.12** に固定する。

## ログイン

`createLumorphiaOAuthConfig` を Better Auth の `genericOAuth` に渡す。認可コード + PKCE S256、`client_secret_post`、署名検証と nonce の照合を使う。ID トークンが無い応答、検証に必要な discovery が無い発行元、期待した issuer / audience / EdDSA と異なるトークンは受け入れない。claim は設定した issuer の JWKS で検証した ID トークンから読む。

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { betterAuth } from "better-auth";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { createLumorphiaOAuthConfig } from "@lumorphia/auth-client";
import type { VerifiedLogin } from "@lumorphia/auth-client";

// この context はリクエストごとに作る。認証インスタンス全体の変数に保存しない。
const context = new AsyncLocalStorage<{ login?: VerifiedLogin }>();
const auth = betterAuth({
  // database / baseURL / secret はサービスの設定。
  account: { accountLinking: { enabled: false } },
  user: {
    additionalFields: {
      lumorphiaSub: { type: "string", required: false, unique: true, input: false },
    },
  },
  session: {
    additionalFields: {
      lumorphiaSid: { type: "string", required: false, input: false },
      lumorphiaIdToken: {
        type: "string",
        required: false,
        input: false,
        returned: false,
      },
    },
  },
  plugins: [
    genericOAuth({
      config: [
        createLumorphiaOAuthConfig({
          issuer: process.env.LUMORPHIA_ISSUER!, // https://accounts.lumorphia.com/api/auth
          clientId: process.env.LUMORPHIA_CLIENT_ID!,
          clientSecret: process.env.LUMORPHIA_CLIENT_SECRET!,
          // identities: true は scope を登録した Prismtone だけ。
          onVerifiedLogin(login) {
            const store = context.getStore();
            if (!store) throw new Error("Missing login request context");
            store.login = login;
          },
        }),
      ],
    }),
  ],
  databaseHooks: {
    user: {
      create: {
        async before(user) {
          const login = context.getStore()?.login;
          if (!login) throw new Error("Missing verified Lumorphia login");
          return { data: { ...user, lumorphiaSub: login.claims.sub } };
        },
      },
    },
    session: {
      create: {
        async before(session) {
          const login = context.getStore()?.login;
          if (!login) throw new Error("Missing verified Lumorphia login");
          return {
            data: {
              ...session,
              lumorphiaSid: login.sid,
              lumorphiaIdToken: login.idToken,
            },
          };
        },
      },
    },
  },
});

export function handleAuth(request: Request) {
  return context.run({}, () => auth.handler(request));
}
```

この例は新規の OIDC 専用サービス向け。既存ユーザーの引き継ぎ・ほかのログイン方法・セッション更新は、サービス側の明示的な対応付けと hook を足す。RP の Cookie・DB・セッションはサービスごとに独立させる。

- サービス側で `lumorphiaSub` を `users.lumorphia_sub` (unique) に、セッションの追加項目をそのサービスのテーブルに対応付けてマイグレーションする。`platform` はテーブルを持たない。
- Better Auth 1.7.7 は `input: false` の項目を OAuth のプロフィール変換から除く。`required: false` にして **サーバーの create hook で設定**する。ブラウザから書ける `input: true` に変えない。DB で必須にする場合も create hook が値を渡す。
- アカウントの識別子は検証した `sub`。メールの一致による自動連携は無効にする。既存アカウントへの結び付けはサービスが引き継ぎフローで明示する。
- `onVerifiedLogin` は署名と claim の検証後、ローカルのユーザー・セッション作成より前に呼ぶ。ここでは要求の context に保持し、ログインが成功して session を作るときに保存する。コールバックが失敗した場合はログインも失敗する。
- `handle` を表示名に使う。bio、role、ban、利用規約への同意はサービス側で持つ。`legacyPending` はサービスの引き継ぎ導線で使い、`identities` は要求した場合だけ返す。現在 accounts の `legacy_pending` は空配列。
- ID トークンをログ・画面・ブラウザの session 応答に含めない。`returned: false` を設定し、サーバーの DB から現在のセッションに結び付いた値を読む。秘密を使う設定をブラウザに import しない。

`parseLumorphiaClaims(profile, { identities: true })` は **型・形の検証だけ**を行う。未検証の JWT を decode した値を渡して信頼しない。戻り値は `sub` / `handle` / `legacyPending` / 任意の `identities`。元の配列を変更しない。

## サービスからログアウト

```ts
import { createLogoutUrl } from "@lumorphia/auth-client";

const url = createLogoutUrl({
  issuer,
  clientId,
  postLogoutRedirectUri: registeredRedirectUri,
  state: serverGeneratedState,
  idTokenHint: currentSession.lumorphiaIdToken,
});
```

認証済みのログアウト要求でサービスの現在のセッションを終了し、ブラウザをこの URL に向ける。戻り先は accounts に登録した HTTPS の URI に固定する。`state` は要求ごとにランダムに作ってサーバーに保存し、戻ったときに照合して消す。HTTP の入口で CSRF を検証する。hint を省略すると accounts の確認フォームを使う。

Better Auth の自動 provider logout は無効にする。`account.idToken` は同じ利用者の別端末によるログインで上書きされるため、**現在の RP セッションに結び付けた ID トークン**を使う。`createLogoutUrl` はトークンを検証・保存したり、セッションを削除したりしない。

## back-channel logout

```ts
import { createBackchannelLogoutHandler, createLogoutTokenVerifier } from "@lumorphia/auth-client";

const handleLogout = createBackchannelLogoutHandler({
  verifyLogoutToken: createLogoutTokenVerifier({ issuer, clientId }),
  adapter: {
    async logoutOnce(event) {
      // サービスの DB のトランザクションで以下を実行する。
      // (issuer, clientId, jti) を unique に記録。既存なら成功として戻る。
      // issuer / clientId / sub / sid が一致する RP セッションだけ削除する。
      // 削除に失敗したら jti の記録も rollback する。
    },
  },
});
```

accounts に登録した専用の受信 URI で `Request` を渡し、返った `Response` をそのまま返す。サーバー間の POST なのでブラウザ Cookie や Origin を要求しない。アダプターは実装必須で、例のコメントを実際の DB 操作に置き換える。

- 発行元の固定 JWKS、EdDSA、`typ: logout+jwt`、issuer、client audience、`sub` / `sid` / `iat` / `exp` / `jti`、空の back-channel event、nonce が無いことを検証する。Lumorphia は `sub` と `sid` の **両方**を要求し、利用者の全端末を一括で消さない。
- 有効期間は最大120秒、時計の許容差は5秒。アダプターは `jti` を少なくとも `expiresAt` の5秒後まで保持する。複数プロセス・並行配送でも1回にするため、セッション削除と記録を同じトランザクションにする。メモリの Set は本番で使わない。
- 成功・処理済みは200、無効なトークン・フォームは400、非 POST は405、不正な Content-Type は415、16 KiB を超えるフォームは413、アダプターの失敗は500。応答は `no-store` でトークンや内部エラーを含めない。
- accounts の配送は1回で再送しない。受信失敗はサービスの監視で拾う。退会通知とその再送は A1.4 の専用の仕組みで扱う。

## 検証

`pnpm --filter @lumorphia/auth-client test` で claim、Logout Token、HTTP の受け口、実際の Better Auth の `generic-oauth` / memory adapter による認可要求・コード交換・session 作成を確かめる。テストの発行元 HTTP 応答だけを差し替え、JWT は Ed25519 で生成して JWKS で検証する。accounts の PostgreSQL・ブラウザ E2E とのサービス接続は、利用側への組み込みで確認する。
