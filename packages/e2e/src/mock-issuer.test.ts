import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createAccountEventVerifier,
  createLogoutTokenVerifier,
  createLumorphiaOAuthConfig,
} from "@lumorphia/auth-client";
import { startMockIssuer, type MockIssuer, type MockLumorphiaUser } from "./mock-issuer.ts";

// 発行元のふりが出すものを、サービスが使う auth-client そのもので確かめる。auth-client と食い違えば、
// サービスの E2E が本物の accounts と違う形で通ってしまう

const CLIENT_ID = "test-e2e-client";

/** サービスのアプリのふり。発行元のふりが送る back-channel logout と退会の知らせを受け取る */
let app: Server;
let appBaseUrl: string;
let received: { path: string; body: URLSearchParams }[] = [];
let appStatus = 204;
let mock: MockIssuer;

const user = (overrides: Partial<MockLumorphiaUser> = {}): MockLumorphiaUser => ({
  sub: randomUUID(),
  sid: `test-sid-${randomUUID()}`,
  handle: "test_handle",
  name: "テスト_利用者",
  ...overrides,
});

async function control(path: string, body: unknown) {
  const res = await fetch(`${mock.controlUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function authorize(u: MockLumorphiaUser, nonce = "test-nonce") {
  const { body } = await control("/_e2e/authorize", { nonce, user: u });
  return body.code as string;
}

async function exchange(code: string, clientId = CLIENT_ID) {
  const res = await fetch(`${mock.issuer}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, string> };
}

beforeAll(async () => {
  app = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      received = [...received, { path: req.url ?? "", body: new URLSearchParams(raw) }];
      res.writeHead(appStatus).end();
    });
  });
  await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
  const address = app.address();
  appBaseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  mock = await startMockIssuer({
    clientId: CLIENT_ID,
    service: "scenote",
    tls: {
      cert: process.env.LUMORPHIA_E2E_TEST_CERT!,
      key: process.env.LUMORPHIA_E2E_TEST_KEY!,
    },
    appBaseUrl,
    extraRoutes: async (request) =>
      request.path === "/api/test/echo"
        ? { status: 200, body: { sub: request.user?.sub ?? null } }
        : null,
  });
});

afterAll(async () => {
  await mock.close();
  await new Promise((resolve) => app.close(resolve));
});

beforeEach(() => {
  received = [];
  appStatus = 204;
});

describe("discovery", () => {
  it("serves the issuer under /api/auth like the real accounts", async () => {
    expect(mock.issuer).toMatch(/^https:\/\/127\.0\.0\.1:\d+\/api\/auth$/);
  });

  it("advertises the endpoints the services use", async () => {
    const res = await fetch(`${mock.issuer}/.well-known/openid-configuration`);
    expect(await res.json()).toMatchObject({
      issuer: mock.issuer,
      token_endpoint: `${mock.issuer}/oauth2/token`,
      userinfo_endpoint: `${mock.issuer}/oauth2/userinfo`,
      end_session_endpoint: `${mock.issuer}/oauth2/end-session`,
      jwks_uri: `${mock.issuer}/jwks`,
    });
  });
});

describe("login", () => {
  it("logs in through auth-client's getUserInfo with the authorized user", async () => {
    const u = user({ picture: "https://img.example.invalid/a.webp" });
    const { body } = await exchange(await authorize(u));
    const config = createLumorphiaOAuthConfig({
      issuer: mock.issuer,
      clientId: CLIENT_ID,
      clientSecret: "test-secret",
    });
    const info = await config.getUserInfo!({
      idToken: body.id_token,
      accessToken: body.access_token,
    });
    expect(info).toMatchObject({
      sub: u.sub,
      name: u.name,
      image: u.picture,
      emailVerified: true,
      "https://lumorphia.com/handle": u.handle,
    });
  });

  it("hands auth-client the sid of the Lumorphia session", async () => {
    const u = user();
    const { body } = await exchange(await authorize(u));
    let sid: string | null = null;
    const config = createLumorphiaOAuthConfig({
      issuer: mock.issuer,
      clientId: CLIENT_ID,
      clientSecret: "test-secret",
      onVerifiedLogin: (login) => {
        sid = login.sid;
      },
    });
    await config.getUserInfo!({ idToken: body.id_token, accessToken: body.access_token });
    expect(sid).toBe(u.sid);
  });

  it("puts the nonce of the authorization request into the ID token", async () => {
    const { body } = await exchange(await authorize(user(), "test-nonce-2"));
    const payload = JSON.parse(Buffer.from(body.id_token!.split(".")[1]!, "base64url").toString());
    expect(payload.nonce).toBe("test-nonce-2");
  });

  it("accepts a code only once", async () => {
    const code = await authorize(user());
    await exchange(code);
    expect((await exchange(code)).status).toBe(400);
  });

  it("refuses a code for another client", async () => {
    expect((await exchange(await authorize(user()), "test-other-client")).status).toBe(400);
  });

  it("refuses UserInfo without a token it issued", async () => {
    const res = await fetch(`${mock.issuer}/oauth2/userinfo`, {
      headers: { authorization: "Bearer test-unknown" },
    });
    expect(res.status).toBe(401);
  });
});

describe("accounts API", () => {
  it("returns the user's characters to the access token", async () => {
    const characters = [{ id: "test-character", lodestoneId: "1", name: "Test Chara" }];
    const { body } = await exchange(await authorize(user({ characters })));
    const res = await fetch(`${mock.issuer.replace(/\/api\/auth$/, "")}/api/characters`, {
      headers: { authorization: `Bearer ${body.access_token}` },
    });
    expect(await res.json()).toEqual({ characters });
  });

  it("answers routes the service adds, with the user of the access token", async () => {
    const u = user();
    const { body } = await exchange(await authorize(u));
    const res = await fetch(`${mock.issuer.replace(/\/api\/auth$/, "")}/api/test/echo`, {
      headers: { authorization: `Bearer ${body.access_token}` },
    });
    expect(await res.json()).toEqual({ sub: u.sub });
  });

  it("answers an unknown path with 404", async () => {
    const res = await fetch(`${mock.issuer.replace(/\/api\/auth$/, "")}/api/test/nope`);
    expect(res.status).toBe(404);
  });
});

describe("back-channel logout", () => {
  it("sends the app a Logout Token that auth-client accepts", async () => {
    const u = user();
    await control("/_e2e/backchannel-logout", { sub: u.sub, sid: u.sid });
    const [sent] = received;
    expect(sent?.path).toBe("/api/lumorphia/backchannel-logout");
    const verify = createLogoutTokenVerifier({ issuer: mock.issuer, clientId: CLIENT_ID });
    expect(await verify(sent!.body.get("logout_token")!)).toMatchObject({
      sub: u.sub,
      sid: u.sid,
    });
  });

  it("reports the status the app answered with", async () => {
    appStatus = 400;
    const u = user();
    const { body } = await control("/_e2e/backchannel-logout", { sub: u.sub, sid: u.sid });
    expect(body).toEqual({ status: 400 });
  });
});

describe("account events", () => {
  const verify = () =>
    createAccountEventVerifier({ issuer: mock.issuer, clientId: CLIENT_ID, service: "scenote" });

  it("sends a deletion with the 30 day recovery deadline that auth-client accepts", async () => {
    const sub = randomUUID();
    await control("/_e2e/account-event", { sub, state: "deleted" });
    const [sent] = received;
    expect(sent?.path).toBe("/api/lumorphia/account-events");
    const event = await verify()(sent!.body.get("event_token")!);
    expect(event).toMatchObject({ sub, state: "deleted", scope: "account", service: "scenote" });
    expect(Date.parse(event.recoverUntil!) - Date.parse(event.deletedAt!)).toBe(30 * 86_400_000);
  });

  it("sends a recovery without a deadline", async () => {
    const sub = randomUUID();
    await control("/_e2e/account-event", { sub, state: "active", scope: "service" });
    const event = await verify()(received[0]!.body.get("event_token")!);
    expect(event).toMatchObject({ state: "active", scope: "service", deletedAt: null });
  });

  it("raises the revision for each event of the same user", async () => {
    const sub = randomUUID();
    await control("/_e2e/account-event", { sub, state: "deleted" });
    await control("/_e2e/account-event", { sub, state: "active" });
    const [first, second] = await Promise.all(
      received.map((r) => verify()(r.body.get("event_token")!)),
    );
    expect([first?.revision, second?.revision]).toEqual([1, 2]);
  });

  it("can send the same event twice, as accounts does when it retries", async () => {
    const sub = randomUUID();
    const { body } = await control("/_e2e/account-event", { sub, state: "purged" });
    await control("/_e2e/account-event", { sub, resend: body.eventId });
    const [first, second] = await Promise.all(
      received.map((r) => verify()(r.body.get("event_token")!)),
    );
    expect(second?.eventId).toBe(first?.eventId);
    expect(second?.revision).toBe(first?.revision);
  });
});
