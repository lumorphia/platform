import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

/**
 * E2E 用の Lumorphia アカウントの発行元のふり (lumorphia/prismtone の e2e/mock-lumorphia.ts から)。
 * - https (`port`): サービスのサーバーが叩く discovery・JWKS・token・UserInfo と、accounts の API
 *   (`/api/characters`、サービスが足す `extraRoutes`)。証明書は ./tls.ts
 * - http (`controlPort`): テストからの操作。認可画面はブラウザ側で spec が受け (./playwright.ts)、ここに
 *   nonce と利用者を渡して code をもらう。back-channel logout と退会の知らせもここから送らせる
 *
 * 本物の accounts (Better Auth 1.7.7) に合わせ、email などの標準の claim は ID トークンに入れず UserInfo でだけ返す
 */

export interface MockLumorphiaUser {
  readonly sub: string;
  /** Lumorphia のセッション。ID トークンの sid と back-channel logout に使う */
  readonly sid: string;
  readonly handle: string;
  readonly name: string;
  readonly picture?: string | null;
  readonly identities?: readonly { readonly provider: string; readonly id: string }[];
  /** accounts の GET /api/characters が返すキャラクター。形はそのまま返す */
  readonly characters?: readonly unknown[];
}

export type LumorphiaServiceName = "prismtone" | "scenote" | "facetia";

/** サービスが足す accounts の API (`/api/...`)。null を返すと 404 */
export type MockIssuerRoute = (request: {
  readonly method: string;
  readonly path: string;
  readonly searchParams: URLSearchParams;
  readonly body: string;
  /** Authorization の access token の利用者。無ければ null */
  readonly user: MockLumorphiaUser | null;
}) => Promise<{ readonly status: number; readonly body: unknown } | null>;

export interface MockIssuerOptions {
  readonly clientId: string;
  /** 退会の知らせの宛先のサービス (auth-client の createAccountEventVerifier と揃える) */
  readonly service: LumorphiaServiceName;
  /** https の証明書と鍵のファイル */
  readonly tls: { readonly cert: string; readonly key: string };
  /** back-channel logout と退会の知らせを送る先 (サービスのアプリ) */
  readonly appBaseUrl: string;
  /** 0 なら空いているポート */
  readonly port?: number;
  readonly controlPort?: number;
  /**
   * end-session から戻してよいオリジン。既定は appBaseUrl のオリジン。ブラウザが開くホスト名
   * (`https://scenote.lumorphia.test:3445` など) が appBaseUrl と違うときに渡す
   */
  readonly postLogoutRedirectOrigins?: readonly string[];
  readonly backchannelLogoutPath?: string;
  readonly accountEventsPath?: string;
  readonly extraRoutes?: MockIssuerRoute;
}

export interface MockIssuer {
  /** `https://127.0.0.1:<port>/api/auth` */
  readonly issuer: string;
  /** `http://127.0.0.1:<controlPort>` */
  readonly controlUrl: string;
  close(): Promise<void>;
}

type LifecycleState = "active" | "deleted" | "purged";
type Lifecycle = {
  service: LumorphiaServiceName;
  revision: number;
  state: LifecycleState;
  scope: "account" | "service";
  occurredAt: string;
  deletedAt: string | null;
  recoverUntil: string | null;
};

const RECOVERY_MS = 30 * 86_400_000;

class AppUnreachable extends Error {}

/**
 * 認可の口 (GET /oauth2/authorize) で承認する利用者を渡す Cookie。発行元のオリジンに置く (./playwright.ts)。
 * ブラウザのコンテキストごとに持つので、並列のテストでも混ざらない
 */
export const E2E_USER_COOKIE = "lumorphia_e2e_user";

export function encodeE2eUser(user: MockLumorphiaUser): string {
  return Buffer.from(JSON.stringify(user)).toString("base64url");
}

const cookieValue = (req: IncomingMessage, name: string): string | null => {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
};

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });

const listen = (server: Server, port: number) =>
  new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });

const close = (server: Server) =>
  new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });

const bearer = (req: IncomingMessage) => (req.headers.authorization ?? "").replace(/^Bearer /, "");

/** ID トークンと UserInfo に共通の Lumorphia の claim */
const lumorphiaClaims = (u: MockLumorphiaUser) => ({
  sub: u.sub,
  "https://lumorphia.com/handle": u.handle,
  "https://lumorphia.com/legacy_pending": [],
  "https://lumorphia.com/identities": u.identities ?? [],
});

export async function startMockIssuer(options: MockIssuerOptions): Promise<MockIssuer> {
  const backchannelLogoutPath =
    options.backchannelLogoutPath ?? "/api/lumorphia/backchannel-logout";
  const accountEventsPath = options.accountEventsPath ?? "/api/lumorphia/account-events";
  const postLogoutOrigins = new Set(
    (options.postLogoutRedirectOrigins ?? [options.appBaseUrl]).map((url) => new URL(url).origin),
  );
  const keys = await generateKeyPair("EdDSA");
  const kid = "e2e-key";
  const jwk = { ...(await exportJWK(keys.publicKey)), kid, alg: "EdDSA" };
  // code と access token から、認可したときの利用者と nonce を引く
  const codes = new Map<string, { user: MockLumorphiaUser; nonce: string }>();
  const tokens = new Map<string, MockLumorphiaUser>();
  // 退会の知らせ。送り直しのために eventId から引けるようにし、revision は利用者ごとに数える
  const events = new Map<string, { sub: string; lifecycle: Lifecycle }>();
  const revisions = new Map<string, number>();
  let issuer = "";

  const sign = (payload: Record<string, unknown>, typ: string) =>
    new SignJWT(payload)
      .setProtectedHeader({ alg: "EdDSA", kid, typ })
      .setIssuer(issuer)
      .setAudience(options.clientId)
      .setIssuedAt();

  const postToApp = async (path: string, form: Record<string, string>) => {
    try {
      const res = await fetch(new URL(path, options.appBaseUrl), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(form).toString(),
      });
      return res.status;
    } catch (error) {
      // アプリに届かない (証明書を信頼していない、起動していない)。テストに理由を返す
      const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
      throw new AppUnreachable(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const sendAccountEvent = async (eventId: string) => {
    const event = events.get(eventId)!;
    const token = await sign({ lifecycle: event.lifecycle }, "lumorphia-account-event+jwt")
      .setSubject(event.sub)
      .setJti(eventId)
      .setExpirationTime("2m")
      .sign(keys.privateKey);
    return postToApp(accountEventsPath, { event_token: token });
  };

  const issuerServer = createHttpsServer(
    { cert: readFileSync(options.tls.cert), key: readFileSync(options.tls.key) },
    async (req, res) => {
      const url = new URL(req.url ?? "/", issuer);
      if (url.pathname === "/api/auth/.well-known/openid-configuration")
        return json(res, 200, {
          issuer,
          authorization_endpoint: `${issuer}/oauth2/authorize`,
          token_endpoint: `${issuer}/oauth2/token`,
          userinfo_endpoint: `${issuer}/oauth2/userinfo`,
          end_session_endpoint: `${issuer}/oauth2/end-session`,
          jwks_uri: `${issuer}/jwks`,
          id_token_signing_alg_values_supported: ["EdDSA"],
        });
      if (url.pathname === "/api/auth/jwks") return json(res, 200, { keys: [jwk] });
      // 認可の画面のふり。Cookie の利用者をそのまま承認し、code を付けて戻す (同意の画面は出さない。
      // 自社クライアントは accounts でも同意を省く)
      if (url.pathname === "/api/auth/oauth2/authorize" && req.method === "GET") {
        const encoded = cookieValue(req, E2E_USER_COOKIE);
        const redirectUri = url.searchParams.get("redirect_uri");
        if (
          !encoded ||
          !redirectUri ||
          !URL.canParse(redirectUri) ||
          url.searchParams.get("client_id") !== options.clientId
        )
          return json(res, 400, { error: "invalid_request" });
        const user = JSON.parse(Buffer.from(encoded, "base64url").toString()) as MockLumorphiaUser;
        const code = randomUUID();
        codes.set(code, { user, nonce: url.searchParams.get("nonce") ?? "" });
        const back = new URL(redirectUri);
        back.searchParams.set("code", code);
        const state = url.searchParams.get("state");
        if (state) back.searchParams.set("state", state);
        res.writeHead(302, { location: back.href, "cache-control": "no-store" });
        return res.end();
      }
      // accounts のログアウト。確認の画面は出さず、登録した戻り先へ state を付けて戻す
      if (url.pathname === "/api/auth/oauth2/end-session") {
        const back = url.searchParams.get("post_logout_redirect_uri");
        if (!back || !URL.canParse(back) || !postLogoutOrigins.has(new URL(back).origin))
          return json(res, 400, { error: "invalid_request" });
        const location = new URL(back);
        const state = url.searchParams.get("state");
        if (state) location.searchParams.set("state", state);
        res.writeHead(302, { location: location.href, "cache-control": "no-store" });
        return res.end();
      }
      if (url.pathname === "/api/auth/oauth2/token" && req.method === "POST") {
        const form = new URLSearchParams(await readBody(req));
        const code = form.get("code") ?? "";
        const grant = codes.get(code);
        if (!grant || form.get("client_id") !== options.clientId)
          return json(res, 400, { error: "invalid_grant" });
        codes.delete(code);
        const accessToken = randomUUID();
        tokens.set(accessToken, grant.user);
        const idToken = await sign(
          { ...lumorphiaClaims(grant.user), sid: grant.user.sid, nonce: grant.nonce },
          "JWT",
        )
          .setExpirationTime("5m")
          .sign(keys.privateKey);
        return json(res, 200, {
          access_token: accessToken,
          token_type: "Bearer",
          expires_in: 300,
          id_token: idToken,
        });
      }
      if (url.pathname === "/api/auth/oauth2/userinfo") {
        const u = tokens.get(bearer(req));
        if (!u) return json(res, 401, { error: "invalid_token" });
        return json(res, 200, {
          ...lumorphiaClaims(u),
          email: `${u.handle}@example.invalid`,
          email_verified: true,
          name: u.name,
          ...(u.picture ? { picture: u.picture } : {}),
        });
      }
      const u = tokens.get(bearer(req)) ?? null;
      if (url.pathname === "/api/characters" && req.method === "GET") {
        if (!u) return json(res, 401, { error: "invalid_token" });
        return json(res, 200, { characters: u.characters ?? [] });
      }
      const extra = await options.extraRoutes?.({
        method: req.method ?? "GET",
        path: url.pathname,
        searchParams: url.searchParams,
        body: await readBody(req),
        user: u,
      });
      if (extra) return json(res, extra.status, extra.body);
      return json(res, 404, { error: "not_found" });
    },
  );

  const controlServer = createHttpServer((req, res) => {
    control(req, res).catch((error: unknown) => {
      if (error instanceof AppUnreachable)
        return json(res, 502, { error: `app_unreachable: ${error.message}` });
      return json(res, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });

  const control = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/health") return json(res, 200, { ok: true });
    if (req.method !== "POST") return json(res, 404, { error: "not_found" });
    const body = JSON.parse((await readBody(req)) || "{}") as Record<string, unknown>;
    // 認可画面のふり: { nonce, user } で code を返す
    if (url.pathname === "/_e2e/authorize") {
      const code = randomUUID();
      codes.set(code, { user: body.user as MockLumorphiaUser, nonce: String(body.nonce) });
      return json(res, 200, { code });
    }
    // accounts の back-channel logout: { sub, sid } で Logout Token を送り、アプリの応答の状態を返す
    if (url.pathname === "/_e2e/backchannel-logout") {
      const token = await sign(
        { sid: body.sid, events: { "http://schemas.openid.net/event/backchannel-logout": {} } },
        "logout+jwt",
      )
        .setSubject(String(body.sub))
        .setJti(randomUUID())
        .setExpirationTime("2m")
        .sign(keys.privateKey);
      return json(res, 200, {
        status: await postToApp(backchannelLogoutPath, { logout_token: token }),
      });
    }
    // accounts の退会の知らせ: { sub, state, scope? } で新しい知らせを、{ sub, resend: eventId } で同じ知らせを送り直す
    if (url.pathname === "/_e2e/account-event") {
      if (typeof body.resend === "string") {
        if (!events.has(body.resend)) return json(res, 404, { error: "unknown_event" });
        return json(res, 200, {
          eventId: body.resend,
          status: await sendAccountEvent(body.resend),
        });
      }
      const sub = String(body.sub);
      const state = body.state as LifecycleState;
      const now = new Date();
      const revision = (revisions.get(sub) ?? 0) + 1;
      revisions.set(sub, revision);
      const eventId = randomUUID();
      events.set(eventId, {
        sub,
        lifecycle: {
          service: options.service,
          revision,
          state,
          scope: body.scope === "service" ? "service" : "account",
          occurredAt: now.toISOString(),
          deletedAt: state === "deleted" ? now.toISOString() : null,
          recoverUntil:
            state === "deleted" ? new Date(now.getTime() + RECOVERY_MS).toISOString() : null,
        },
      });
      return json(res, 200, { eventId, status: await sendAccountEvent(eventId) });
    }
    return json(res, 404, { error: "not_found" });
  };

  const port = await listen(issuerServer, options.port ?? 0);
  issuer = `https://127.0.0.1:${port}/api/auth`;
  const controlPort = await listen(controlServer, options.controlPort ?? 0);
  return {
    issuer,
    controlUrl: `http://127.0.0.1:${controlPort}`,
    close: async () => {
      await Promise.all([close(issuerServer), close(controlServer)]);
    },
  };
}
