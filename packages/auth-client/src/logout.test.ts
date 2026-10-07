import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import {
  createLogoutUrl,
  createLogoutTokenVerifier,
  createBackchannelLogoutHandler,
} from "./logout.ts";

const issuer = "https://accounts.lumorphia.test/api/auth";
const clientId = "test-client";
const eventName = "http://schemas.openid.net/event/backchannel-logout";
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let publicJwk: Awaited<ReturnType<typeof exportJWK>>;
beforeAll(async () => {
  keys = await generateKeyPair("EdDSA");
  publicJwk = { ...(await exportJWK(keys.publicKey)), kid: "test-key", alg: "EdDSA" };
});
afterEach(() => vi.unstubAllGlobals());

async function token(
  overrides: Record<string, unknown> = {},
  typ = "logout+jwt",
  signingKey = keys.privateKey,
) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: issuer,
    aud: clientId,
    sub: "test-sub",
    sid: "test-sid",
    iat: now,
    exp: now + 120,
    jti: "test-jti",
    events: { [eventName]: {} },
    ...overrides,
  })
    .setProtectedHeader({ alg: "EdDSA", kid: "test-key", typ })
    .sign(signingKey);
}
function verifier() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL) => {
      expect(String(url)).toBe(`${issuer}/jwks`);
      return Response.json({ keys: [publicJwk] });
    }),
  );
  return createLogoutTokenVerifier({ issuer, clientId });
}
function request(body: string, method = "POST", contentType = "application/x-www-form-urlencoded") {
  return new Request("https://scenote.lumorphia.test/logout", {
    method,
    ...(method === "POST" ? { body } : {}),
    headers: { "content-type": contentType },
  });
}

describe("createLogoutUrl", () => {
  const config = {
    issuer,
    clientId,
    postLogoutRedirectUri: "https://scenote.lumorphia.test/signed-out",
    state: "test-state",
  };
  it("encodes the current session hint and logout state", () => {
    const url = new URL(createLogoutUrl({ ...config, idTokenHint: "test-token+&" }));
    expect(url.pathname).toBe("/api/auth/oauth2/end-session");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: clientId,
      post_logout_redirect_uri: config.postLogoutRedirectUri,
      state: config.state,
      id_token_hint: "test-token+&",
    });
  });
  it("supports the provider confirmation flow without a hint", () => {
    expect(new URL(createLogoutUrl(config)).searchParams.has("id_token_hint")).toBe(false);
  });
  it.each([
    "http://accounts.lumorphia.test/api/auth",
    "https://test-secret@accounts.lumorphia.test/api/auth",
    `${issuer}?next=elsewhere`,
    `${issuer}#fragment`,
  ])("rejects an unsafe issuer %s", (unsafeIssuer) => {
    expect(() => createLogoutUrl({ ...config, issuer: unsafeIssuer })).toThrow();
  });
  it("rejects an insecure redirect", () => {
    expect(() =>
      createLogoutUrl({ ...config, postLogoutRedirectUri: "http://scenote.lumorphia.test/" }),
    ).toThrow();
  });
  it("requires logout state", () => {
    expect(() => createLogoutUrl({ ...config, state: "" })).toThrow();
  });
});

describe("createLogoutTokenVerifier", () => {
  it("verifies the issuer JWKS and returns a session-scoped event", async () => {
    const verified = await verifier()(await token());
    expect(verified).toMatchObject({
      issuer,
      clientId,
      sub: "test-sub",
      sid: "test-sid",
      jti: "test-jti",
    });
    expect(verified.expiresAt).toBeInstanceOf(Date);
  });
  it.each([
    { iss: "https://other.lumorphia.test/api/auth" },
    { aud: "test-other-client" },
    { exp: 1 },
    { iat: Math.floor(Date.now() / 1000) + 100 },
    { iat: 1 },
    { exp: undefined },
    { iat: undefined },
    { jti: "" },
    { sid: undefined },
    { sub: undefined },
    { nonce: "test-nonce" },
    { nonce: null },
    { events: {} },
    { events: { [eventName]: [] } },
    { events: { [eventName]: { extra: true } } },
    { exp: Math.floor(Date.now() / 1000) + 3600 },
  ])("rejects invalid logout claims %j", async (overrides) => {
    await expect(verifier()(await token(overrides))).rejects.toThrow();
  });
  it("rejects ID tokens as logout tokens", async () => {
    await expect(verifier()(await token({}, "JWT"))).rejects.toThrow();
  });
  it("rejects a forged signature", async () => {
    const forged = await generateKeyPair("EdDSA");
    await expect(verifier()(await token({}, "logout+jwt", forged.privateKey))).rejects.toThrow();
  });
});

describe("createBackchannelLogoutHandler", () => {
  const event = {
    issuer,
    clientId,
    sub: "test-sub",
    sid: "test-sid",
    jti: "test-jti",
    expiresAt: new Date(Date.now() + 120000),
  };
  function setup() {
    const logoutOnce = vi.fn(async () => {});
    const verifyLogoutToken = vi.fn(async () => event);
    return {
      logoutOnce,
      verifyLogoutToken,
      handler: createBackchannelLogoutHandler({ verifyLogoutToken, adapter: { logoutOnce } }),
    };
  }
  it("passes verified session identifiers to the adapter", async () => {
    const { handler, logoutOnce, verifyLogoutToken } = setup();
    expect((await handler(request("logout_token=test-token"))).status).toBe(200);
    expect(verifyLogoutToken).toHaveBeenCalledWith("test-token");
    expect(logoutOnce).toHaveBeenCalledWith(event);
  });
  it("accepts a duplicate after the adapter atomically handles it once", async () => {
    const seen = new Set<string>();
    const deleteSession = vi.fn();
    const handler = createBackchannelLogoutHandler({
      verifyLogoutToken: async () => event,
      adapter: {
        logoutOnce: async ({ jti }) => {
          if (!seen.has(jti)) {
            deleteSession();
            seen.add(jti);
          }
        },
      },
    });
    const statuses = await Promise.all([
      handler(request("logout_token=test-token")),
      handler(request("logout_token=test-token")),
    ]);
    expect(statuses.map((response) => response.status)).toEqual([200, 200]);
    expect(deleteSession).toHaveBeenCalledTimes(1);
  });
  it("rejects invalid signatures before invoking the adapter", async () => {
    const { handler, logoutOnce, verifyLogoutToken } = setup();
    verifyLogoutToken.mockRejectedValueOnce(new Error("test-invalid-token"));
    expect((await handler(request("logout_token=test-token"))).status).toBe(400);
    expect(logoutOnce).not.toHaveBeenCalled();
  });
  it("reports adapter failures so the sender sees a failed delivery", async () => {
    const { handler, logoutOnce } = setup();
    logoutOnce.mockRejectedValueOnce(new Error("test-database-unavailable"));
    expect((await handler(request("logout_token=test-token"))).status).toBe(500);
  });
  it.each(["", "logout_token=", "logout_token=test-one&logout_token=test-two"])(
    "rejects malformed forms %s",
    async (body) => {
      const { handler, logoutOnce } = setup();
      expect((await handler(request(body))).status).toBe(400);
      expect(logoutOnce).not.toHaveBeenCalled();
    },
  );
  it("rejects non POST requests", async () => {
    expect((await setup().handler(request("", "GET"))).status).toBe(405);
  });
  it("rejects non form requests", async () => {
    expect((await setup().handler(request("{}", "POST", "application/json"))).status).toBe(415);
  });
  it("rejects oversized forms before verification", async () => {
    const { handler, verifyLogoutToken } = setup();
    expect((await handler(request(`logout_token=${"x".repeat(17000)}`))).status).toBe(413);
    expect(verifyLogoutToken).not.toHaveBeenCalled();
  });
});
