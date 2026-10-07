import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import {
  createAccountEventHandler,
  createAccountEventVerifier,
  type AccountEvent,
} from "./account-events.ts";
const issuer = "https://accounts.lumorphia.test/api/auth";
const clientId = "test-client";
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let publicJwk: Awaited<ReturnType<typeof exportJWK>>;
beforeAll(async () => {
  keys = await generateKeyPair("EdDSA");
  publicJwk = { ...(await exportJWK(keys.publicKey)), kid: "test-key", alg: "EdDSA" };
});
afterEach(() => vi.unstubAllGlobals());
const lifecycle = {
  service: "scenote",
  revision: 1,
  state: "deleted",
  scope: "account",
  occurredAt: "2026-10-07T00:00:00.000Z",
  deletedAt: "2026-10-07T00:00:00.000Z",
  recoverUntil: "2026-11-06T00:00:00.000Z",
};
async function token(overrides: Record<string, unknown> = {}, typ = "lumorphia-account-event+jwt") {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: issuer,
    aud: clientId,
    sub: "test-sub",
    jti: "test-event",
    iat: now,
    exp: now + 120,
    lifecycle,
    ...overrides,
  })
    .setProtectedHeader({ alg: "EdDSA", kid: "test-key", typ })
    .sign(keys.privateKey);
}
function verifier() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL) => {
      expect(String(url)).toBe(`${issuer}/jwks`);
      return Response.json({ keys: [publicJwk] });
    }),
  );
  return createAccountEventVerifier({ issuer, clientId, service: "scenote" });
}
const req = (body: string, method = "POST", contentType = "application/x-www-form-urlencoded") =>
  new Request("https://scenote.lumorphia.test/api/lumorphia/account-events", {
    method,
    ...(method === "POST" ? { body } : {}),
    headers: { "content-type": contentType },
  });
describe("account event verification", () => {
  it("verifies the fixed issuer, audience and dedicated event token type", async () => {
    expect(await verifier()(await token())).toMatchObject({
      issuer,
      clientId,
      sub: "test-sub",
      eventId: "test-event",
      ...lifecycle,
    });
  });
  it.each([
    { iss: "https://other.example/api/auth" },
    { aud: "test-other" },
    { exp: 1 },
    { nonce: "test-nonce" },
    { lifecycle: { ...lifecycle, service: "prismtone" } },
    { lifecycle: { ...lifecycle, revision: 0 } },
    { lifecycle: { ...lifecycle, state: "other" } },
    { lifecycle: { ...lifecycle, recoverUntil: "2026-11-07T00:00:00.000Z" } },
    { lifecycle: { ...lifecycle, deletedAt: null } },
    { lifecycle: { ...lifecycle, state: "active" } },
  ])("rejects an invalid event %j", async (overrides) => {
    await expect(verifier()(await token(overrides))).rejects.toThrow();
  });
  it("rejects a logout or ID token as an account event", async () => {
    await expect(verifier()(await token({}, "logout+jwt"))).rejects.toThrow();
  });
  it("accepts active and purged snapshots with no deletion deadline", async () => {
    for (const state of ["active", "purged"])
      expect(
        await verifier()(
          await token({ lifecycle: { ...lifecycle, state, deletedAt: null, recoverUntil: null } }),
        ),
      ).toMatchObject({ state });
  });
});
describe("account event HTTP boundary", () => {
  const event = {
    issuer,
    clientId,
    sub: "test-sub",
    eventId: "test-event",
    ...lifecycle,
  } as AccountEvent;
  it("acknowledges only after the adapter commits the event", async () => {
    const apply = vi.fn(async (value) => {
      expect(value).toEqual(event);
    });
    const handler = createAccountEventHandler({
      verify: async () => event,
      adapter: { applyOnce: apply },
    });
    expect((await handler(req("event_token=test-token"))).status).toBe(204);
    expect(apply).toHaveBeenCalledOnce();
  });
  it("returns a retryable failure when the adapter cannot commit", async () => {
    const handler = createAccountEventHandler({
      verify: async () => event,
      adapter: {
        applyOnce: async () => {
          throw new Error("test-db-failure");
        },
      },
    });
    expect((await handler(req("event_token=test-token"))).status).toBe(500);
  });
  it("rejects a duplicate form field before verifying", async () => {
    const verify = vi.fn(async () => event);
    const handler = createAccountEventHandler({ verify, adapter: { applyOnce: async () => {} } });
    expect((await handler(req("event_token=test-one&event_token=test-two"))).status).toBe(400);
    expect(verify).not.toHaveBeenCalled();
  });
  it("limits the body while streaming it", async () => {
    const handler = createAccountEventHandler({
      verify: async () => event,
      adapter: { applyOnce: async () => {} },
    });
    expect((await handler(req(`event_token=${"x".repeat(17000)}`))).status).toBe(413);
  });
  it("requires POST and the form content type", async () => {
    const handler = createAccountEventHandler({
      verify: async () => event,
      adapter: { applyOnce: async () => {} },
    });
    expect((await handler(req("", "GET"))).status).toBe(405);
    expect((await handler(req("{}", "POST", "application/json"))).status).toBe(415);
  });
  it("does not invoke the adapter for an invalid signature", async () => {
    const applyOnce = vi.fn(async () => {});
    const handler = createAccountEventHandler({
      verify: async () => {
        throw new Error("invalid token");
      },
      adapter: { applyOnce },
    });
    expect((await handler(req("event_token=test-invalid"))).status).toBe(400);
    expect(applyOnce).not.toHaveBeenCalled();
  });
});
