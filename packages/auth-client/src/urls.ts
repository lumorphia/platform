export function httpsUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("An HTTPS URL without credentials or fragment is required");
  }
  return url;
}

export function normalizeIssuer(value: string): string {
  const url = httpsUrl(value);
  if (url.search) throw new Error("Issuer must not contain a query");
  return url.href.replace(/\/$/, "");
}
