export interface LumorphiaIdentity {
  readonly provider: string;
  readonly id: string;
}

export interface LumorphiaClaims {
  readonly sub: string;
  readonly handle: string;
  readonly legacyPending: readonly string[];
  readonly identities?: readonly LumorphiaIdentity[];
}

/** Lumorphia を正とする表示名とアイコン。サービスはこれを写して表示する (prismtone ADR-0052)。 */
export interface LumorphiaProfile {
  readonly name: string;
  /** accounts に置いたアイコンの https の URL。未設定なら null */
  readonly picture: string | null;
}

export function claimRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid Lumorphia claims");
  }
  return value as Record<string, unknown>;
}

export function claimString(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Invalid Lumorphia claim string");
  }
  return value;
}

/** 署名検証済みの ID トークンまたは UserInfo の形だけを検証する。 */
export function parseLumorphiaClaims(
  profile: unknown,
  options: { readonly identities?: boolean } = {},
): LumorphiaClaims {
  const raw = claimRecord(profile);
  const pending = raw["https://lumorphia.com/legacy_pending"];
  if (!Array.isArray(pending)) throw new Error("Invalid legacy_pending claim");
  const base = {
    sub: claimString(raw.sub),
    handle: claimString(raw["https://lumorphia.com/handle"]),
    legacyPending: pending.map(claimString),
  };
  if (!options.identities) return base;
  const identities = raw["https://lumorphia.com/identities"];
  if (!Array.isArray(identities)) throw new Error("Invalid identities claim");
  return {
    ...base,
    identities: identities.map((value: unknown) => {
      const identity = claimRecord(value);
      return { provider: claimString(identity.provider), id: claimString(identity.id) };
    }),
  };
}

/** UserInfo の標準の name・picture を検証する。picture はそのまま img に入るので https の URL に限る。 */
export function parseLumorphiaProfile(profile: unknown): LumorphiaProfile {
  const raw = claimRecord(profile);
  const name = claimString(raw.name);
  if (raw.picture === undefined || raw.picture === null) return { name, picture: null };
  const picture = claimString(raw.picture);
  if (!URL.canParse(picture) || new URL(picture).protocol !== "https:")
    throw new Error("Invalid picture claim");
  return { name, picture };
}
