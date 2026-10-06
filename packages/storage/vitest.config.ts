import { defineConfig } from "vitest/config";
import { readPlatformSource } from "../../vitest.source.ts";
export default defineConfig({
  ...readPlatformSource,
  test: { name: "storage", include: ["src/**/*.test.ts"] },
});
