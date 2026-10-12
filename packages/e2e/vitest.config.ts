import { defineConfig } from "vitest/config";
import { readPlatformSource } from "../../vitest.source.ts";
export default defineConfig({
  ...readPlatformSource,
  // 発行元のふりは https。テストの CA を作り、Worker を起こす前に NODE_EXTRA_CA_CERTS で信頼させる
  test: { name: "e2e", include: ["src/**/*.test.ts"], globalSetup: ["src/test-setup.ts"] },
});
