import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 公開するパッケージの package.json の決まり。公開してから気づくと直せない (同じ版は出し直せない)
const root = new URL("..", import.meta.url);
const read = (path: string) =>
  JSON.parse(readFileSync(new URL(path, root), "utf8")) as Record<string, unknown> & {
    version: string;
  };

const PACKAGES = ["media", "storage", "ops", "auth-client"] as const;
const manifest = read(".release-please-manifest.json") as unknown as Record<string, string>;
const config = read("release-please-config.json") as unknown as {
  packages: Record<string, { component?: string }>;
};

describe.each(PACKAGES)("@lumorphia/%s", (dir) => {
  const pkg = read(`packages/${dir}/package.json`);

  it("is named after its directory", () => {
    expect(pkg.name).toBe(`@lumorphia/${dir}`);
  });

  it("is published to GitHub Packages", () => {
    expect(pkg.private).toBeUndefined();
    expect(pkg.publishConfig).toEqual({ registry: "https://npm.pkg.github.com" });
  });

  it("points at this repository so GitHub links the package to it", () => {
    expect(pkg.repository).toEqual({
      type: "git",
      url: "git+https://github.com/lumorphia/platform.git",
      directory: `packages/${dir}`,
    });
  });

  it("carries the license of the repository", () => {
    expect(pkg.license).toBe("AGPL-3.0-only");
  });

  it("ships the built files", () => {
    expect(pkg.files).toContain("dist");
  });

  it("is released on its own version by release-please", () => {
    expect(config.packages[`packages/${dir}`]?.component).toBe(dir);
    expect(pkg.version).toBe(manifest[`packages/${dir}`]);
  });
});
