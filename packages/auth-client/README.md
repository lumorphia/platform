# @lumorphia/auth-client

Lumorphia accounts を発行元に使うサービスの、OIDC ログイン・claim・ログアウトの受け口。サーバーで使う。Better Auth は accounts と同じ **1.7.7**、jose は **6.2.12** に固定する。

## ログイン

`createLumorphiaOAuthConfig` を Better Auth の `genericOAuth` に渡す。認可コード + PKCE S256、`client_secret_post`、署名検証と nonce の照合を使う。ID トークンが無い応答、検証に必要な discovery が無い発行元、期待した issuer / audience / EdDSA と異なるトークンは受け入れない。ID トークンを設定した issuer の JWKS で検証したあと、access token を使って同じ issuer の UserInfo から最新の claim を読む。sub が一致しない場合や active でない場合、UserInfo が失敗した場合はローカルの session を作らない。

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
- `onVerifiedLogin` は署名・最新の UserInfo と claim の検証後、ローカルのユーザー・セッション作成より前に呼ぶ。ここでは要求の context に保持し、ログインが成功して session を作るときに保存する。コールバックが失敗した場合はログインも失敗する。
- 表示名とアイコンは UserInfo の `name` と `picture` から読み、`login.profile` (`name`、`picture`。アイコンが無ければ `null`) で渡す。Better Auth の利用者の `name` と `image` にも入るが、アイコンを消した人の `image` は Better Auth が書き換えないので、写しは必ず `login.profile` から書く。Lumorphia が正なので、サービスはログインのたびに写しを書き換える ([ADR-0007](../../docs/adr/0007-profile-from-userinfo.md))。`picture` は https の URL だけを受け入れる。bio、role、ban、利用規約への同意はサービス側で持つ。`legacyPending` はサービスの引き継ぎ導線で使い、`identities` は要求した場合だけ返す。現在 accounts の `legacy_pending` は空配列。
- ID トークンをログ・画面・ブラウザの session 応答に含めない。`returned: false` を設定し、サーバーの DB から現在のセッションに結び付いた値を読む。秘密を使う設定をブラウザに import しない。

`parseLumorphiaClaims(profile, { identities: true })` は **型・形の検証だけ**を行う。未検証の JWT を decode した値を渡して信頼しない。戻り値は `sub` / `handle` / `legacyPending` / 任意の `identities`。元の配列を変更しない。 `parseLumorphiaProfile(userinfo)` は `name` / `picture` の形を検証する。

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

## 退会・復旧・物理削除の通知

```ts
import { createAccountEventHandler, createAccountEventVerifier } from "@lumorphia/auth-client";

const handleAccountEvent = createAccountEventHandler({
  verify: createAccountEventVerifier({ issuer, clientId, service: "scenote" }),
  adapter: {
    async applyOnce(event) {
      // サービス自身の DB トランザクションで実装する。
      // (issuer, service, sub) の最終 revision と eventId を記録する。
      // 古い revision と重複は成功として戻し、状態を再適用しない。
      // 状態変更、セッション失効、画像削除の投入と記録を原子的に行う。
      // 失敗したらすべて rollback する。
    },
  },
});
```

accounts のクライアント設定 `lifecycleUri` に登録した受信先で `Request` を渡し、返った `Response` を返す。既定のパスは `/api/lumorphia/account-events`。サーバー間の専用 POST なので Cookie と Origin を要求しない。アダプターのコメントを実際の DB 操作に置き換える。

- 固定された issuer / JWKS、EdDSA、client audience、`typ: lumorphia-account-event+jwt`、最大 120 秒の有効期間、nonce が無いことを検証する。時計の許容差は 5 秒。
- `eventId` と `revision` は再送でも変わらず、署名時刻だけ更新される。JWT の短い有効期間とは別に、サービス内の sub ごとの最終 revision を永続化する。クライアントの更新で audience が複数あっても、同じサービスの状態を重複適用しない。
- `state` は `active` / `deleted` / `purged`、`scope` は `account` / `service`。`deleted` は `deletedAt` とその 30 日後の `recoverUntil` を持つ。ほかの状態では両方 null。`occurredAt` は再送時も元の発生日時。
- `deleted` は非表示化、全 RP セッションの失効、画像の削除要求を投入する。`active` は復旧可能な文字情報と連携を戻すが、削除要求済みの画像は戻さない。`purged` は旧データの物理削除を受け持つ。非同期の画像削除などは RP 自身の永続的なジョブに投入し、投入と状態変更を同じトランザクションで確定する。
- 送信側は同じ audience で revision の順に送る。期限切れ後の再利用は `purged` のあとに `active` が来る。古い revision が現在の状態を戻さないようにし、独立したサービス退会を全体復旧で取り消さない。RP の ban、role、規約同意は通知で上書きしない。
- RP のログイン hook は自分の退会期限も検査する。期限切れの旧データは先に削除し、新たな利用を始める。通知の到着や worker だけを待って復旧しない。UserInfo の検査は Lumorphia の最新の active 状態を確認するもので、RP のローカル状態処理を代行しない。
- 受付と重複は 204、無効なフォーム・トークンは 400、非 POST は 405、不正な Content-Type は 415、16 KiB を超える本文は 413、DB アダプターの失敗は 500。accounts は 2xx を確認してから配送済みとし、それ以外は再送する。応答とログにトークンや内部エラーを出さない。

Prismtone / Scenote への実際の DB アダプターの接続は A2 / A3 で行う。設計は [ADR-0006](../../docs/adr/0006-account-event-delivery.md)。
