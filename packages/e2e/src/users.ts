import { randomBytes, randomUUID } from "node:crypto";
import type { MockLumorphiaUser } from "./mock-issuer.ts";

/**
 * テストごとに別の Lumorphia の利用者を作る。handle は accounts の決まり (英小文字・数字・_、3〜20 文字) で、
 * サービスの中でも一意になる。名前は「テスト_」で始め、手元の画面で本物と見分ける
 */
export function lumorphiaUser(overrides: Partial<MockLumorphiaUser> = {}): MockLumorphiaUser {
  return {
    sub: randomUUID(),
    sid: `e2e-sid-${randomUUID()}`,
    handle: `lm_${randomBytes(5).toString("hex")}`,
    name: "テスト_ルモルフィア",
    ...overrides,
  };
}
