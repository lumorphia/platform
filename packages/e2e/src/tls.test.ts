import { X509Certificate } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { certificateSpki, ensureE2eTls } from "./tls.ts";

let dir: string;
let paths: { ca: string; cert: string; key: string };

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "lumorphia-e2e-tls-"));
  paths = ensureE2eTls(dir);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("ensureE2eTls", () => {
  it("issues a server certificate signed by its own CA", async () => {
    const ca = new X509Certificate(await readFile(paths.ca));
    const cert = new X509Certificate(await readFile(paths.cert));
    expect(cert.verify(ca.publicKey)).toBe(true);
  });

  it("covers 127.0.0.1 and localhost", async () => {
    const cert = new X509Certificate(await readFile(paths.cert));
    expect(cert.subjectAltName).toContain("IP Address:127.0.0.1");
    expect(cert.subjectAltName).toContain("DNS:localhost");
  });

  it("keeps the certificate under the 398 days browsers accept", async () => {
    const cert = new X509Certificate(await readFile(paths.cert));
    const days = (Date.parse(cert.validTo) - Date.parse(cert.validFrom)) / 86_400_000;
    expect(days).toBeLessThanOrEqual(398);
  });

  it("does not issue again when the files are already there", async () => {
    const before = (await stat(paths.cert)).mtimeMs;
    expect(ensureE2eTls(dir)).toEqual(paths);
    expect((await stat(paths.cert)).mtimeMs).toBe(before);
  });

  it("leaves only the CA, the certificate and its key behind", async () => {
    const { readdir } = await import("node:fs/promises");
    expect((await readdir(dir)).sort()).toEqual(["ca-key.pem", "ca.pem", "cert.pem", "key.pem"]);
  });
});

describe("certificateSpki", () => {
  it("hashes the public key the way Chromium's spki list expects", async () => {
    const spki = certificateSpki(paths.cert);
    expect(spki).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  });

  it("gives the same hash for the same certificate", () => {
    expect(certificateSpki(paths.cert)).toBe(certificateSpki(paths.cert));
  });
});
