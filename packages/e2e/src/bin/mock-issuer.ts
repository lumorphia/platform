#!/usr/bin/env node
// Playwright の webServer から起こす発行元のふり。設定は環境変数 (../env.ts)
import { mockIssuerOptionsFromEnv } from "../env.ts";
import { startMockIssuer } from "../mock-issuer.ts";

const mock = await startMockIssuer(mockIssuerOptionsFromEnv(process.env));
console.log(`mock Lumorphia issuer: ${mock.issuer} (control ${mock.controlUrl})`);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => void mock.close().then(() => process.exit(0)));
