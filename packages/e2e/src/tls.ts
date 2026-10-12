import { execFileSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface E2eTlsPaths {
  readonly ca: string;
  readonly cert: string;
  readonly key: string;
}

/**
 * E2E 専用の CA と、127.0.0.1・localhost のサーバー証明書を `dir` に作る (lumorphia/prismtone の e2e/tls.ts から)。
 * auth-client は発行元に https を求めるので、発行元のふり (mock-issuer) に使う。サービスのアプリは
 * NODE_EXTRA_CA_CERTS でこの CA を信頼する。開発の CA (`*.lumorphia.test`) とは分ける。
 * 3 つのファイルが揃っていれば作り直さない。openssl が要る
 */
export function ensureE2eTls(dir: string): E2eTlsPaths {
  const paths = { ca: join(dir, "ca.pem"), cert: join(dir, "cert.pem"), key: join(dir, "key.pem") };
  if (existsSync(paths.ca) && existsSync(paths.cert) && existsSync(paths.key)) return paths;
  mkdirSync(dir, { recursive: true });
  const caKey = join(dir, "ca-key.pem");
  const csr = join(dir, "cert.csr");
  const ext = join(dir, "cert.ext");
  const openssl = (args: readonly string[]) => execFileSync("openssl", args, { stdio: "ignore" });
  openssl([
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    caKey,
    "-out",
    paths.ca,
    "-days",
    "3650",
    "-subj",
    "/CN=Lumorphia E2E CA",
    "-addext",
    "basicConstraints=critical,CA:TRUE",
    "-addext",
    "keyUsage=critical,keyCertSign,cRLSign",
  ]);
  openssl([
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    paths.key,
    "-out",
    csr,
    "-subj",
    "/CN=127.0.0.1",
  ]);
  writeFileSync(
    ext,
    [
      "basicConstraints=CA:FALSE",
      "keyUsage=critical,digitalSignature,keyEncipherment",
      "extendedKeyUsage=serverAuth",
      "subjectAltName=IP:127.0.0.1,DNS:localhost",
    ].join("\n"),
  );
  // ブラウザは 398 日より長いサーバー証明書を拒む
  openssl([
    "x509",
    "-req",
    "-in",
    csr,
    "-CA",
    paths.ca,
    "-CAkey",
    caKey,
    "-CAcreateserial",
    "-out",
    paths.cert,
    "-days",
    "397",
    "-extfile",
    ext,
  ]);
  rmSync(csr);
  rmSync(ext);
  rmSync(join(dir, "ca.srl"), { force: true });
  return paths;
}

/**
 * 証明書の公開鍵 (SPKI) の SHA-256 (base64)。Chromium の `--ignore-certificate-errors-spki-list` に渡すと、
 * その鍵の証明書だけを信頼する。ignoreHTTPSErrors は接続のたびに証明書のエラーを通るので、読み込みが
 * ときどき net::ERR_TOO_MANY_RETRIES で落ちる (lumorphia/accounts で起きた)
 */
export function certificateSpki(certPath: string): string {
  const spki = new X509Certificate(readFileSync(certPath)).publicKey.export({
    type: "spki",
    format: "der",
  });
  return createHash("sha256").update(spki).digest("base64");
}
