import { describe, expect, it } from "vitest";
import { formatUpdatedAt, parseLegalDocument, renderLegalMarkdown } from "./document.ts";

describe("parseLegalDocument", () => {
  it("reads the version and the revision date from the frontmatter", () => {
    expect(
      parseLegalDocument('---\nversion: "2.0"\nupdatedAt: "2026-10-09"\n---\n\n# 利用規約\n'),
    ).toEqual({ version: "2.0", updatedAt: "2026-10-09", markdown: "\n# 利用規約\n" });
  });

  it("rejects a document without frontmatter", () => {
    expect(() => parseLegalDocument("# 利用規約\n")).toThrow();
  });

  it("rejects a document without a version or date", () => {
    expect(() => parseLegalDocument('---\nversion: "1.0"\n---\n')).toThrow();
  });

  it("rejects a version that is not major.minor", () => {
    expect(() =>
      parseLegalDocument('---\nversion: "v1"\nupdatedAt: "2026-10-09"\n---\n'),
    ).toThrow();
  });
});

describe("renderLegalMarkdown", () => {
  it("turns headings, paragraphs and lists into HTML", () => {
    const html = renderLegalMarkdown("# 見出し\n\n本文。\n\n- 項目\n");
    expect(html).toContain("<h1>見出し</h1>");
    expect(html).toContain("<p>本文。</p>");
    expect(html).toContain("<li>項目</li>");
  });

  it("does not pass raw HTML through", () => {
    expect(renderLegalMarkdown("<script>alert(1)</script>")).not.toContain("<script>");
  });
});

describe("formatUpdatedAt", () => {
  it("writes the date in Japanese", () => {
    expect(formatUpdatedAt("2026-10-09")).toBe("2026 年 10 月 9 日");
  });
});
