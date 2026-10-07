import { AsyncLocalStorage } from "node:async_hooks";
import type { VerifiedLogin } from "./provider.ts";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createLumorphiaOAuthConfig } from "./provider.ts";

const issuer = "https://accounts.lumorphia.test/api/auth";
const rp = "https://scenote.lumorphia.test";
const clientId = "test-client";
const clientSecret = "test-client-secret";
const profile = {
  sub: "test-sub",
  sid: "test-sid",
  email: "test-user@example.com",
  email_verified: true,
  "https://lumorphia.com/handle": "test_handle",
  "https://lumorphia.com/legacy_pending": [],
};
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
beforeAll(async () => {
  keys = await generateKeyPair("EdDSA");
});
afterEach(() => vi.unstubAllGlobals());

async function setup(
  overrides: Record<string, unknown> = {},
  options: { missingJwks?: boolean; missingToken?: boolean; secondLogin?: boolean } = {},
) {
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: "test-key", alg: "EdDSA" };
  const context = new AsyncLocalStorage<{ login?: VerifiedLogin }>();
  const onVerifiedLogin = vi.fn((login: VerifiedLogin) => {
    context.getStore()!.login = login;
  });
  const database: Record<string, Record<string, unknown>[]> = {
    user: [],
    account: [],
    session: [],
    verification: [],
  };
  if (options.secondLogin)
    database.user = [
      {
        id: "test-existing-user",
        name: "existing",
        email: profile.email,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === `${issuer}/.well-known/openid-configuration`)
      return Response.json({
        issuer,
        authorization_endpoint: `${issuer}/oauth2/authorize`,
        token_endpoint: `${issuer}/oauth2/token`,
        userinfo_endpoint: `${issuer}/oauth2/userinfo`,
        end_session_endpoint: `${issuer}/oauth2/end-session`,
        id_token_signing_alg_values_supported: ["EdDSA"],
        ...(!options.missingJwks ? { jwks_uri: `${issuer}/jwks` } : {}),
      });
    if (url === `${issuer}/jwks`) return Response.json({ keys: [jwk] });
    if (url === `${issuer}/oauth2/token`) {
      const form = new URLSearchParams(String(init?.body));
      expect(form.get("client_id")).toBe(clientId);
      expect(form.get("client_secret")).toBe(clientSecret);
      expect(form.get("grant_type")).toBe("authorization_code");
      expect(form.get("code_verifier")).toBeTruthy();
      const idToken = await new SignJWT({
        ...profile,
        nonce: authorization.searchParams.get("nonce"),
        ...overrides,
      })
        .setProtectedHeader({ alg: "EdDSA", kid: "test-key", typ: "JWT" })
        .setIssuer(typeof overrides.iss === "string" ? overrides.iss : issuer)
        .setAudience(typeof overrides.aud === "string" ? overrides.aud : clientId)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(keys.privateKey);
      return Response.json({
        access_token: "test-access-token",
        token_type: "Bearer",
        expires_in: 300,
        ...(!options.missingToken ? { id_token: idToken } : {}),
      });
    }
    throw new Error(`Unexpected test fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetch);
  const auth = betterAuth({
    baseURL: rp,
    secret: "test-rp-secret-long-enough-for-better-auth",
    database: memoryAdapter(database),
    account: { accountLinking: { enabled: false } },
    user: {
      additionalFields: {
        lumorphiaSub: { type: "string", required: false, unique: true, input: false },
      },
    },
    session: {
      additionalFields: {
        lumorphiaSid: { type: "string", required: false, input: false },
        lumorphiaIdToken: { type: "string", required: false, input: false, returned: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const login = context.getStore()?.login;
            if (!login) throw new Error("Missing verified login");
            return { data: { ...user, lumorphiaSub: login.claims.sub } };
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const login = context.getStore()?.login;
            if (!login) throw new Error("Missing verified login");
            return {
              data: { ...session, lumorphiaSid: login.sid, lumorphiaIdToken: login.idToken },
            };
          },
        },
      },
    },
    plugins: [
      genericOAuth({
        config: [createLumorphiaOAuthConfig({ issuer, clientId, clientSecret, onVerifiedLogin })],
      }),
    ],
    logger: { disabled: true },
  });
  const handle = (request: Request) => context.run({}, () => auth.handler(request));
  const start = await handle(
    new Request(`${rp}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: rp },
      body: JSON.stringify({ provider: "lumorphia", callbackURL: `${rp}/done` }),
    }),
  );
  if (start.status !== 200) return { start, database, onVerifiedLogin, fetch };
  const authorization = new URL(((await start.json()) as { url: string }).url);
  const cookie = start.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const callback = await handle(
    new Request(
      `${rp}/api/auth/callback/lumorphia?code=test-code&state=${encodeURIComponent(authorization.searchParams.get("state")!)}`,
      { headers: { cookie } },
    ),
  );
  return { start, callback, authorization, database, onVerifiedLogin, fetch, handle };
}

describe("createLumorphiaOAuthConfig", () => {
  it("requires verified ID tokens and PKCE with client secret post", () => {
    expect(createLumorphiaOAuthConfig({ issuer, clientId, clientSecret })).toMatchObject({
      providerId: "lumorphia",
      discoveryUrl: `${issuer}/.well-known/openid-configuration`,
      pkce: true,
      requireIdTokenVerification: true,
      tokenEndpointAuth: { method: "client_secret_post" },
      scopes: ["openid", "profile", "email"],
      disableProviderLogout: true,
    });
  });
  it("requests identities only when explicitly enabled", () => {
    expect(
      createLumorphiaOAuthConfig({ issuer, clientId, clientSecret, identities: true }).scopes,
    ).toContain("lumorphia:identities");
  });
  it("maps the handle without overriding the local user id", async () => {
    const config = createLumorphiaOAuthConfig({ issuer, clientId, clientSecret });
    expect(await config.mapProfileToUser!({ ...profile, emailVerified: true })).toEqual({
      name: "test_handle",
    });
  });
  it("rejects missing client credentials", () => {
    expect(() => createLumorphiaOAuthConfig({ issuer, clientId, clientSecret: "" })).toThrow();
  });
});

describe("Better Auth generic-oauth integration", () => {
  it("creates a local session through a signed nonce-bound OIDC callback", async () => {
    const { callback, authorization, database, onVerifiedLogin } = await setup();
    expect(authorization?.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorization?.searchParams.get("nonce")).toBeTruthy();
    expect(callback?.headers.get("location")).toBe(`${rp}/done`);
    expect(database.session).toHaveLength(1);
    expect(database.session?.[0]).toMatchObject({
      lumorphiaSid: "test-sid",
      lumorphiaIdToken: expect.any(String),
    });
    expect(database.user?.[0]).toMatchObject({ lumorphiaSub: "test-sub", name: "test_handle" });
    expect(database.account?.[0]).toMatchObject({ providerId: "lumorphia", accountId: "test-sub" });
    expect(onVerifiedLogin).toHaveBeenCalledWith(
      expect.objectContaining({
        issuer,
        clientId,
        sid: "test-sid",
        claims: expect.objectContaining({ sub: "test-sub" }),
        idToken: expect.any(String),
      }),
    );
  });
  it.each([
    { nonce: "test-wrong-nonce" },
    { iss: "https://other.lumorphia.test/api/auth" },
    { aud: "test-other-client" },
    { email: undefined },
    { email_verified: undefined },
    { sub: "" },
    { sid: undefined },
    { "https://lumorphia.com/handle": undefined },
    { "https://lumorphia.com/legacy_pending": 1 },
  ])("rejects invalid callback claims %j before session creation", async (overrides) => {
    const { database, onVerifiedLogin } = await setup(overrides);
    expect(database.session).toHaveLength(0);
    expect(onVerifiedLogin).not.toHaveBeenCalled();
  });
  it("fails closed when discovery has no verification keys", async () => {
    const { start, database } = await setup({}, { missingJwks: true });
    expect(start.status).not.toBe(200);
    expect(database.session).toHaveLength(0);
  });
  it("rejects a token response without an ID token", async () => {
    const { database, onVerifiedLogin } = await setup({}, { missingToken: true });
    expect(database.session).toHaveLength(0);
    expect(onVerifiedLogin).not.toHaveBeenCalled();
  });
  it("keeps the session ID token out of browser session responses", async () => {
    const { callback, handle } = await setup();
    const cookie = callback!.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const response = await handle!(
      new Request(`${rp}/api/auth/get-session`, { headers: { cookie } }),
    );
    const body = (await response.json()) as { session: Record<string, unknown> };
    expect(body.session.lumorphiaSid).toBe("test-sid");
    expect(body.session).not.toHaveProperty("lumorphiaIdToken");
  });
  it("prevents a browser from replacing the verified subject", async () => {
    const { callback, handle, database } = await setup();
    const cookie = callback!.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const response = await handle!(
      new Request(`${rp}/api/auth/update-user`, {
        method: "POST",
        headers: { cookie, origin: rp, "content-type": "application/json" },
        body: JSON.stringify({ lumorphiaSub: "test-other-sub" }),
      }),
    );
    expect(response.status).toBe(400);
    expect(database.user?.[0]?.lumorphiaSub).toBe("test-sub");
  });
  it("does not link an unrelated local user by matching email", async () => {
    const { database } = await setup({}, { secondLogin: true });
    expect(database.session).toHaveLength(0);
    expect(database.account).toHaveLength(0);
  });
});
