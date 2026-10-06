import tseslint from "typescript-eslint";

// 依存の向き (AGENTS.md)。flat config は同じルールを後ろの設定で上書きするので、パッケージごとに制限を全部並べる

const SERVICES = {
  group: ["@prismtone/*", "@scenote/*", "@facetia/*", "lumorphia-*"],
  message: "共通基盤はサービスを知らない。サービスの都合は引数やアダプターで受け取る",
};
const UMBRA = {
  group: ["@lumorphia/moderation", "@lumorphia/moderation/*"],
  message: "public の platform は private の umbra に依存しない (向きは umbra -> platform だけ)",
};
const DEEP = {
  group: ["@lumorphia/*/src/*", "@lumorphia/*/dist/*"],
  message: "ほかのパッケージは package.json の exports から使う",
};

const restrict = (patterns) => ({
  rules: { "no-restricted-imports": ["error", { patterns }] },
});

const media = {
  files: ["packages/media/**/*.ts"],
  ...restrict([
    SERVICES,
    UMBRA,
    DEEP,
    {
      group: ["@lumorphia/storage", "@lumorphia/storage/*", "@aws-sdk/*"],
      message:
        "media は画像の変換だけ。どこに置くかは知らない (置くのは storage と、サービスのジョブ)",
    },
  ]),
};

const storage = {
  files: ["packages/storage/**/*.ts"],
  ...restrict([
    SERVICES,
    UMBRA,
    DEEP,
    {
      group: ["@lumorphia/media", "@lumorphia/media/*", "sharp"],
      message: "storage はバイト列を置くだけ。中身 (画像かどうか) は知らない",
    },
  ]),
};

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/coverage/**"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  media,
  storage,
);
