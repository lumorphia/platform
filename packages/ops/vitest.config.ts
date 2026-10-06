import { defineConfig } from "vitest/config";
import { readPlatformSource } from "../../vitest.source.ts";
export default defineConfig({
  ...readPlatformSource,
  test: { name: "ops", include: ["src/**/*.test.ts"] },
});
