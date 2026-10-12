import { expect, test as base, type Page } from "@playwright/test";
import { E2E_USER_COOKIE, encodeE2eUser, type MockLumorphiaUser } from "./mock-issuer.ts";

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
 * Lumorphia の認可画面のふり。発行元のふりの認可の口 (./mock-issuer.ts) が承認する利用者を、発行元のオリジンの
 * Cookie に置く。ブラウザは本物と同じく認可へ移り、code を持って callback へ戻ってくる。もう一度呼ぶと、
 * 次のログインからその利用者になる。
 * `page.route` と `route.fetch` を使わないのは、route.fetch が Node から送るので Chromium の
 * `--host-resolver-rules` (`*.lumorphia.test`) が効かず、302 の先も page.route に渡らないため
 */
export async function approveLumorphia(
  page: Page,
  user: MockLumorphiaUser,
  location: MockIssuerLocation,
): Promise<void> {
  await page.context().addCookies([
    {
      name: E2E_USER_COOKIE,
      value: encodeE2eUser(user),
      url: new URL(location.issuer).origin,
      secure: true,
      sameSite: "None",
    },
  ]);
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
