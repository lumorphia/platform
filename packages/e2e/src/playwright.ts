import { expect, test as base, type Page } from "@playwright/test";
import type { MockLumorphiaUser } from "./mock-issuer.ts";

export { lumorphiaUser } from "./users.ts";
export type { MockLumorphiaUser } from "./mock-issuer.ts";

/** 発行元のふり (./mock-issuer.ts) の場所。サービスの playwright.config.ts と揃える */
export interface MockIssuerLocation {
  /** `https://127.0.0.1:<port>/api/auth` */
  readonly issuer: string;
  /** `http://127.0.0.1:<controlPort>` */
  readonly controlUrl: string;
}

/**
 * 全 E2E 共通の test。CSP の違反を見張り、テストの終わりに 0 件であることを確かめる (lumorphia/prismtone と同じ)。
 * 違反はブラウザが console にエラーとして出すので、コンテキストの console を集める。
 * browser.newContext() で作った別のコンテキストは見ない
 */
export const test = base.extend<{ cspViolations: string[] }>({
  cspViolations: [
    async ({ context }, use) => {
      const violations: string[] = [];
      context.on("console", (msg) => {
        const text = msg.text();
        if (/Content Security Policy|Refused to/i.test(text)) violations.push(text);
      });
      await use(violations);
      expect(violations, "CSP の違反が console に出た").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/**
 * Lumorphia の認可画面のふり。ブラウザが向かう認可要求を受け、nonce と利用者を発行元のふりに渡して
 * code をもらい、callback へ戻す。ログインし直すたびに、そのとき `user()` が返す利用者が使われる。
 * `loginPath` (既定は /login) がサーバーの 302 で認可へ送る形にも対応する。Chromium は 302 の先を
 * page.route に渡さないので、その応答を受けて、認可へ向かうならここで callback へ送り返す
 */
export async function approveLumorphia(
  page: Page,
  user: () => MockLumorphiaUser,
  location: MockIssuerLocation,
  options: { readonly loginPath?: string } = {},
) {
  const loginPath = options.loginPath ?? "/login";
  const approve = async (authorize: URL) => {
    const res = await page.request.post(`${location.controlUrl}/_e2e/authorize`, {
      data: { nonce: authorize.searchParams.get("nonce"), user: user() },
    });
    const { code } = (await res.json()) as { code: string };
    const back = new URL(authorize.searchParams.get("redirect_uri")!);
    back.searchParams.set("code", code);
    back.searchParams.set("state", authorize.searchParams.get("state")!);
    return back.toString();
  };
  await page.route(`${location.issuer}/oauth2/authorize**`, async (route) => {
    const back = await approve(new URL(route.request().url()));
    await route.fulfill({ status: 302, headers: { location: back } });
  });
  await page.route(
    (url) => url.pathname === loginPath,
    async (route) => {
      const res = await route.fetch({ maxRedirects: 0 });
      const redirect = res.headers()["location"];
      if (res.status() !== 302 || !redirect?.startsWith(`${location.issuer}/oauth2/authorize`)) {
        await route.fulfill({ response: res });
        return;
      }
      const back = await approve(new URL(redirect));
      await route.fulfill({ status: 302, headers: { ...res.headers(), location: back } });
    },
  );
}

/** accounts の back-channel logout のふり。アプリが返した HTTP の状態を返す */
export async function sendBackchannelLogout(
  page: Page,
  user: MockLumorphiaUser,
  location: MockIssuerLocation,
): Promise<number> {
  const res = await page.request.post(`${location.controlUrl}/_e2e/backchannel-logout`, {
    data: { sub: user.sub, sid: user.sid },
  });
  return ((await res.json()) as { status: number }).status;
}

/**
 * accounts の退会の知らせのふり。`resend` に前の eventId を渡すと同じ知らせを送り直す。
 * eventId とアプリが返した HTTP の状態を返す
 */
export async function sendAccountEvent(
  page: Page,
  event:
    | {
        readonly sub: string;
        readonly state: "active" | "deleted" | "purged";
        readonly scope?: "account" | "service";
      }
    | { readonly sub: string; readonly resend: string },
  location: MockIssuerLocation,
): Promise<{ eventId: string; status: number }> {
  const res = await page.request.post(`${location.controlUrl}/_e2e/account-event`, {
    data: event,
  });
  return (await res.json()) as { eventId: string; status: number };
}
