/**
 * 規約・プライバシーポリシーの版と、利用者が同意した版の比較 (lumorphia/prismtone の RM-32 から移した)。
 * 版は本文の frontmatter の version (例: "1.0")。再同意が要るのはメジャー番号が上がったときだけで、
 * 誤字の修正などマイナーでは求めない。同意の記録の形 (1 列か 2 列か) はサービスが決める
 */
export type LegalVersions = { terms: string; privacy: string };

const VERSION = /^(\d+)\.\d+$/;

function major(version: string): number | null {
  const m = VERSION.exec(version);
  return m ? Number(m[1]) : null;
}

/** 同意した版が無い・読めない・どちらかのメジャー番号が違う → 再同意 */
export function needsReconsent(accepted: LegalVersions | null, current: LegalVersions): boolean {
  if (!accepted) return true;
  const terms = major(accepted.terms);
  const privacy = major(accepted.privacy);
  if (terms === null || privacy === null) return true;
  return terms !== major(current.terms) || privacy !== major(current.privacy);
}

/** 1 つの列にまとめて保存するときの形 "terms=1.0;privacy=1.0" (prismtone の users.terms_accepted_version) */
export function formatConsentVersion(v: LegalVersions): string {
  return `terms=${v.terms};privacy=${v.privacy}`;
}

export function parseConsentVersion(value: string | null | undefined): LegalVersions | null {
  if (!value) return null;
  const m = /^terms=(\d+\.\d+);privacy=(\d+\.\d+)$/.exec(value);
  return m ? { terms: m[1]!, privacy: m[2]! } : null;
}
