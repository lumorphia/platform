import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/*",
      // リポジトリ全体の決まり (ESLint の依存の向き、公開する package.json)
      { test: { name: "repo", include: ["tooling/**/*.test.ts"] } },
    ],
    coverage: {
      provider: "v8",
      // lcov は Codecov 用。text は CI のログで読む用
      reporter: ["text", "html", "lcov"],
      include: ["packages/*/src/**"],
      exclude: [
        "**/*.test.ts",
        // パッケージの入口 (export を並べるだけ)
        "packages/*/src/index.ts",
      ],
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
    },
  },
});
