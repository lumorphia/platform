import type { LumorphiaServiceName, MockIssuerOptions } from "./mock-issuer.ts";

const SERVICES: readonly LumorphiaServiceName[] = ["prismtone", "scenote", "facetia"];

const required = (env: Record<string, string | undefined>, name: string): string => {
  const value = env[name];
  if (!value) throw new Error(`${name} が要る`);
  return value;
};

/**
 * bin (lumorphia-mock-issuer) が環境変数から起動の設定を作る。Playwright の webServer の env で渡す。
 * ポートの既定は lumorphia/prismtone で使ってきた 3404 (発行元) と 3405 (操作)
 */
export function mockIssuerOptionsFromEnv(
  env: Record<string, string | undefined>,
): MockIssuerOptions {
  const service = required(env, "LUMORPHIA_SERVICE");
  if (!SERVICES.includes(service as LumorphiaServiceName))
    throw new Error(`LUMORPHIA_SERVICE は ${SERVICES.join(" / ")} のどれか`);
  return {
    clientId: required(env, "LUMORPHIA_CLIENT_ID"),
    service: service as LumorphiaServiceName,
    tls: { cert: required(env, "MOCK_LUMORPHIA_CERT"), key: required(env, "MOCK_LUMORPHIA_KEY") },
    appBaseUrl: required(env, "APP_BASE_URL"),
    port: Number(env.MOCK_LUMORPHIA_PORT ?? 3404),
    controlPort: Number(env.MOCK_LUMORPHIA_CONTROL_PORT ?? 3405),
    ...(env.BACKCHANNEL_LOGOUT_PATH ? { backchannelLogoutPath: env.BACKCHANNEL_LOGOUT_PATH } : {}),
    ...(env.ACCOUNT_EVENTS_PATH ? { accountEventsPath: env.ACCOUNT_EVENTS_PATH } : {}),
  };
}
