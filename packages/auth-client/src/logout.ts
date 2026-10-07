import { createRemoteJWKSet, jwtVerify } from "jose";
import { claimRecord, claimString } from "./claims.ts";
import { httpsUrl, normalizeIssuer } from "./urls.ts";

const LOGOUT_EVENT = "http://schemas.openid.net/event/backchannel-logout";
const MAX_FORM_BYTES = 16 * 1024;

export interface LogoutEvent {
  readonly issuer: string;
  readonly clientId: string;
  readonly sub: string;
  readonly sid: string;
  readonly jti: string;
  readonly expiresAt: Date;
}

/** セッションの削除と jti の記録は同じトランザクションで行う。 */
export interface LogoutAdapter {
  logoutOnce(event: LogoutEvent): Promise<void>;
}
export type LogoutTokenVerifier = (token: string) => Promise<LogoutEvent>;

export function createLogoutUrl(options: {
  readonly issuer: string;
  readonly clientId: string;
  readonly postLogoutRedirectUri: string;
  readonly state: string;
  readonly idTokenHint?: string;
}): string {
  const issuer = normalizeIssuer(options.issuer);
  const redirect = httpsUrl(options.postLogoutRedirectUri);
  const url = new URL(`${issuer}/oauth2/end-session`);
  url.searchParams.set("client_id", claimString(options.clientId));
  url.searchParams.set("post_logout_redirect_uri", redirect.href);
  url.searchParams.set("state", claimString(options.state));
  if (options.idTokenHint !== undefined) {
    url.searchParams.set("id_token_hint", claimString(options.idTokenHint));
  }
  return url.href;
}

export function createLogoutTokenVerifier(options: {
  readonly issuer: string;
  readonly clientId: string;
}): LogoutTokenVerifier {
  const issuer = normalizeIssuer(options.issuer);
  const clientId = claimString(options.clientId);
  // トークンの jku / x5u は使わず、設定した発行元の JWKS だけを読む。
  const jwks = createRemoteJWKSet(new URL(`${issuer}/jwks`));
  return async (token) => {
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: clientId,
      algorithms: ["EdDSA"],
      typ: "logout+jwt",
      requiredClaims: ["iss", "aud", "sub", "sid", "iat", "exp", "jti", "events"],
      maxTokenAge: 120,
      clockTolerance: 5,
    });
    const events = claimRecord(payload.events);
    const logout = claimRecord(events[LOGOUT_EVENT]);
    if (
      "nonce" in payload ||
      Object.keys(events).length !== 1 ||
      Object.keys(logout).length !== 0 ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number" ||
      payload.exp <= payload.iat ||
      payload.exp - payload.iat > 120
    )
      throw new Error("Invalid Lumorphia logout token");
    return {
      issuer,
      clientId,
      sub: claimString(payload.sub),
      sid: claimString(payload.sid),
      jti: claimString(payload.jti),
      expiresAt: new Date(payload.exp * 1000),
    };
  };
}

function response(status: number): Response {
  return new Response(null, {
    status,
    headers: { "cache-control": "no-store", ...(status === 405 ? { allow: "POST" } : {}) },
  });
}

async function readForm(request: Request): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FORM_BYTES) {
        await reader.cancel();
        return null;
      }
      body += decoder.decode(value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

/** フレームワークの HTTP 境界で Request / Response に変換して使う。 */
export function createBackchannelLogoutHandler(options: {
  readonly verifyLogoutToken: LogoutTokenVerifier;
  readonly adapter: LogoutAdapter;
}): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "POST") return response(405);
    if (
      request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
      "application/x-www-form-urlencoded"
    ) {
      return response(415);
    }
    let event: LogoutEvent;
    try {
      const body = await readForm(request);
      if (body === null) return response(413);
      const tokens = new URLSearchParams(body).getAll("logout_token");
      if (tokens.length !== 1 || !tokens[0]) return response(400);
      event = await options.verifyLogoutToken(tokens[0]);
    } catch {
      return response(400);
    }
    try {
      await options.adapter.logoutOnce(event);
      return response(200);
    } catch {
      return response(500);
    }
  };
}
