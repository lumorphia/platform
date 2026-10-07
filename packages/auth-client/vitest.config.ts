import { defineConfig } from "vitest/config";
import { readPlatformSource } from "../../vitest.source.ts";
export default defineConfig({
  ...readPlatformSource,
  test: { name: "auth-client", include: ["src/**/*.test.ts"] },
});
