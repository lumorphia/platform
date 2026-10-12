import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureE2eTls } from "./tls.ts";

/**
 * テストの Worker を起こす前に、発行元のふり (https) の CA を作って信頼させる。NODE_EXTRA_CA_CERTS は
 * プロセスの起動時にしか読まれないので、ここで設定して Worker (子プロセス) に引き継ぐ
 */
export default function setup() {
  const dir = mkdtempSync(join(tmpdir(), "lumorphia-e2e-test-"));
  const tls = ensureE2eTls(dir);
  process.env.NODE_EXTRA_CA_CERTS = tls.ca;
  process.env.LUMORPHIA_E2E_TEST_CERT = tls.cert;
  process.env.LUMORPHIA_E2E_TEST_KEY = tls.key;
  return () => rmSync(dir, { recursive: true, force: true });
}
