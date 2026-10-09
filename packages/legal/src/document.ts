import { marked, type Tokens } from "marked";

/**
 * 規約・プライバシーポリシーなどの本文 (lumorphia/prismtone の RM-20 から移した)。本文は Markdown で、
 * 先頭の frontmatter に版 (version) と改定日 (updatedAt) を書く。ファイルの読み込みはサービスが行う
 * (サーバーは fs、画面はビルド時の取り込み)。ここはブラウザでも動く
 */
export type LegalDocument = {
  /** frontmatter の version ("メジャー.マイナー")。改定のたびに上げる */
  version: string;
  /** frontmatter の updatedAt (YYYY-MM-DD) */
  updatedAt: string;
  /** frontmatter を除いた本文 */
  markdown: string;
};

export function parseLegalDocument(source: string): LegalDocument {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(source);
  if (!m) throw new Error("legal document is missing frontmatter");
  const meta = Object.fromEntries(
    m[1]!.split("\n").map((line) => {
      const [key, ...rest] = line.split(":");
      return [key!.trim(), rest.join(":").trim().replace(/^"|"$/g, "")];
    }),
  ) as Record<string, string | undefined>;
  if (!meta.version || !meta.updatedAt)
    throw new Error("legal document needs version and updatedAt");
  if (!/^\d+\.\d+$/.test(meta.version))
    throw new Error("legal document version must be major.minor");
  return { version: meta.version, updatedAt: meta.updatedAt, markdown: source.slice(m[0].length) };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// 本文は自分たちの Markdown だが、生の HTML は通さない (書き間違いで壊れないように)
const renderer = {
  html: ({ text }: Tokens.HTML | Tokens.Tag) => escapeHtml(text),
};

export function renderLegalMarkdown(markdown: string): string {
  return marked.use({ renderer }).parse(markdown, { async: false, gfm: true });
}

/** 改定日を日本語で書く ("2026 年 10 月 9 日") */
export function formatUpdatedAt(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${y} 年 ${Number(m)} 月 ${Number(d)} 日`;
}
