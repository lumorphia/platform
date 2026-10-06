import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// 依存の向き (AGENTS.md) を eslint.config.js が本当に止めるか。ファイルは作らず、パスだけ与えて検査する
const eslint = new ESLint({ cwd: new URL("..", import.meta.url).pathname });

async function restricted(filePath: string, code: string): Promise<boolean> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).some((m) => m.ruleId === "no-restricted-imports");
}

describe("eslint boundaries", () => {
  it.each(["packages/media/src/x.ts", "packages/storage/src/x.ts"])(
    "keeps %s free of the services",
    async (file) => {
      expect(await restricted(file, 'import "@prismtone/core";')).toBe(true);
      expect(await restricted(file, 'import "@scenote/core";')).toBe(true);
    },
  );

  it.each(["packages/media/src/x.ts", "packages/storage/src/x.ts"])(
    "keeps %s free of the private umbra",
    async (file) => {
      expect(await restricted(file, 'import "@lumorphia/moderation";')).toBe(true);
    },
  );

  it("keeps media free of storage", async () => {
    expect(await restricted("packages/media/src/x.ts", 'import "@lumorphia/storage";')).toBe(true);
  });

  it("keeps storage free of media", async () => {
    expect(await restricted("packages/storage/src/x.ts", 'import "@lumorphia/media";')).toBe(true);
  });

  it("keeps storage free of image decoding", async () => {
    expect(await restricted("packages/storage/src/x.ts", 'import "sharp";')).toBe(true);
  });

  it("makes packages use each other through exports only", async () => {
    const code = 'import "@lumorphia/editor-recipe/src/index.ts";';
    expect(await restricted("packages/media/src/x.ts", code)).toBe(true);
  });

  it("lets media use sharp and Node APIs", async () => {
    const code = 'import "sharp";\nimport "node:crypto";';
    expect(await restricted("packages/media/src/x.ts", code)).toBe(false);
  });

  it("lets storage use the S3 client", async () => {
    expect(await restricted("packages/storage/src/x.ts", 'import "@aws-sdk/client-s3";')).toBe(
      false,
    );
  });
});
