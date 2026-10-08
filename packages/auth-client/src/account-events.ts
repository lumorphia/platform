import { createRemoteJWKSet, jwtVerify } from "jose";
import { claimRecord, claimString } from "./claims.ts";
import { normalizeIssuer } from "./urls.ts";

export type LumorphiaService = "prismtone" | "scenote" | "facetia";
export interface AccountEvent {
  readonly issuer: string;
  readonly clientId: string;
  readonly sub: string;
  readonly eventId: string;
  readonly service: LumorphiaService;
  readonly revision: number;
  readonly state: "active" | "deleted" | "purged";
  readonly scope: "account" | "service";
  readonly occurredAt: string;
  readonly deletedAt: string | null;
  readonly recoverUntil: string | null;
}
/** 状態・セッション失効・画像削除の投入・eventId と revision の記録を同じトランザクションにする。 */
export interface AccountEventAdapter {
  applyOnce(event: AccountEvent): Promise<void>;
}
export type AccountEventVerifier = (token: string) => Promise<AccountEvent>;
const timestamp = (value: unknown): string => {
  const text = claimString(value);
  if (!Number.isFinite(Date.parse(text)) || new Date(text).toISOString() !== text)
    throw new Error("Invalid event timestamp");
  return text;
};
export function createAccountEventVerifier(options: {
  readonly issuer: string;
  readonly clientId: string;
  readonly service: LumorphiaService;
}): AccountEventVerifier {
  const issuer = normalizeIssuer(options.issuer);
  const clientId = claimString(options.clientId);
  const jwks = createRemoteJWKSet(new URL(`${issuer}/jwks`));
  return async (token) => {
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: clientId,
      algorithms: ["EdDSA"],
      typ: "lumorphia-account-event+jwt",
      requiredClaims: ["iss", "aud", "sub", "jti", "iat", "exp", "lifecycle"],
      maxTokenAge: 120,
      clockTolerance: 5,
    });
    const event = claimRecord(payload.lifecycle);
    if (
      "nonce" in payload ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number" ||
      payload.exp <= payload.iat ||
      payload.exp - payload.iat > 120 ||
      event.service !== options.service ||
      !Number.isSafeInteger(event.revision) ||
      Number(event.revision) <= 0 ||
      !["active", "deleted", "purged"].includes(String(event.state)) ||
      !["account", "service"].includes(String(event.scope))
    )
      throw new Error("Invalid Lumorphia account event");
    const deletedAt = event.deletedAt === null ? null : timestamp(event.deletedAt);
    const recoverUntil = event.recoverUntil === null ? null : timestamp(event.recoverUntil);
    if (event.state === "deleted") {
      if (
        !deletedAt ||
        !recoverUntil ||
        Date.parse(recoverUntil) - Date.parse(deletedAt) !== 30 * 86_400_000
      )
        throw new Error("Invalid recovery deadline");
    } else if (deletedAt !== null || recoverUntil !== null)
      throw new Error("Unexpected recovery deadline");
    return {
      issuer,
      clientId,
      sub: claimString(payload.sub),
      eventId: claimString(payload.jti),
      service: options.service,
      revision: Number(event.revision),
      state: event.state as AccountEvent["state"],
      scope: event.scope as AccountEvent["scope"],
      occurredAt: timestamp(event.occurredAt),
      deletedAt,
      recoverUntil,
    };
  };
}
function response(status: number) {
  return new Response(null, {
    status,
    headers: { "cache-control": "no-store", ...(status === 405 ? { allow: "POST" } : {}) },
  });
}
async function readForm(request: Request): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let body = "";
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 16 * 1024) {
        await reader.cancel();
        return null;
      }
      body += decoder.decode(part.value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
export function createAccountEventHandler(options: {
  readonly verify: AccountEventVerifier;
  readonly adapter: AccountEventAdapter;
}): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "POST") return response(405);
    if (
      request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
      "application/x-www-form-urlencoded"
    )
      return response(415);
    let event: AccountEvent;
    try {
      const body = await readForm(request);
      if (body === null) return response(413);
      const tokens = new URLSearchParams(body).getAll("event_token");
      if (tokens.length !== 1 || !tokens[0]) return response(400);
      event = await options.verify(tokens[0]);
    } catch {
      return response(400);
    }
    try {
      await options.adapter.applyOnce(event);
      return response(204);
    } catch {
      return response(500);
    }
  };
}
