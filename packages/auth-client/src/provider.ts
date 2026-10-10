import type { GenericOAuthConfig } from "better-auth/plugins/generic-oauth";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { claimString, parseLumorphiaClaims, parseLumorphiaProfile } from "./claims.ts";
import type { LumorphiaClaims, LumorphiaProfile } from "./claims.ts";
import { normalizeIssuer } from "./urls.ts";

export interface VerifiedLogin {
  readonly issuer: string;
  readonly clientId: string;
  readonly sid: string;
  readonly claims: LumorphiaClaims;
  /** ログインのときの最新の表示名とアイコン (UserInfo) */
  readonly profile: LumorphiaProfile;
  readonly idToken: string;
}

export interface LumorphiaOAuthOptions {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly identities?: boolean;
  /** 現在のログイン要求の文脈に保存し、その要求で作った RP セッションに結び付ける。 */
  readonly onVerifiedLogin?: (login: VerifiedLogin) => void | Promise<void>;
}

export function createLumorphiaOAuthConfig(
  options: LumorphiaOAuthOptions,
): GenericOAuthConfig<"lumorphia"> {
  const issuer = normalizeIssuer(options.issuer);
  const clientId = claimString(options.clientId);
  const clientSecret = claimString(options.clientSecret);
  const jwks = createRemoteJWKSet(new URL(`${issuer}/jwks`));
  return {
    providerId: "lumorphia",
    discoveryUrl: `${issuer}/.well-known/openid-configuration`,
    clientId,
    clientSecret,
    scopes: ["openid", "profile", "email", ...(options.identities ? ["lumorphia:identities"] : [])],
    pkce: true,
    requireIdTokenVerification: true,
    tokenEndpointAuth: { method: "client_secret_post" },
    // Better Auth の account 行の最新の ID トークンは別端末のものになり得る。
    // 現在の RP セッションに保存した hint を createLogoutUrl で使う。
    disableProviderLogout: true,
    accountSubject: ({ profile }) => parseLumorphiaClaims(profile, options).sub,
    async getUserInfo(tokens) {
      if (!tokens.idToken) return null;
      // Better Auth が state / nonce を検証した後、設定した issuer と署名方式も固定して検証する。
      const { payload } = await jwtVerify(tokens.idToken, jwks, {
        issuer,
        audience: clientId,
        algorithms: ["EdDSA"],
        requiredClaims: ["iss", "aud", "sub", "iat", "exp", "sid"],
      });
      const issuedClaims = parseLumorphiaClaims(payload, options);
      // email は ID トークンに入らない (発行元はアクセストークンを出すとき標準の claim を UserInfo でだけ返す)。
      // 下の UserInfo で確かめる
      if (!tokens.accessToken) return null;
      // 通知がまだ届いていない場合にも、ログインのたび発行元の現在の状態を確かめる。
      const response = await fetch(`${issuer}/oauth2/userinfo`, {
        headers: { authorization: `Bearer ${tokens.accessToken}` },
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error("Lumorphia account is unavailable");
      const current = (await response.json()) as Record<string, unknown>;
      const claims = parseLumorphiaClaims(current, options);
      if (claims.sub !== issuedClaims.sub) throw new Error("Lumorphia account subject mismatch");
      const profile = parseLumorphiaProfile(current);
      const sid = claimString(payload.sid);
      const email = claimString(current.email);
      if (typeof current.email_verified !== "boolean")
        throw new Error("Invalid email_verified claim");
      await options.onVerifiedLogin?.({
        issuer,
        clientId,
        sid,
        claims,
        profile,
        idToken: tokens.idToken,
      });
      return {
        ...payload,
        ...current,
        sub: claims.sub,
        name: profile.name,
        email,
        emailVerified: current.email_verified,
        ...(profile.picture ? { image: profile.picture } : {}),
      };
    },
    mapProfileToUser(profile) {
      parseLumorphiaClaims(profile, options);
      return { name: parseLumorphiaProfile(profile).name };
    },
  };
}
