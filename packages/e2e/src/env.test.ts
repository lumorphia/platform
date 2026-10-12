import { describe, expect, it } from "vitest";
import { mockIssuerOptionsFromEnv } from "./env.ts";

const base = {
  LUMORPHIA_CLIENT_ID: "test-client",
  LUMORPHIA_SERVICE: "scenote",
  MOCK_LUMORPHIA_CERT: "/tls/cert.pem",
  MOCK_LUMORPHIA_KEY: "/tls/key.pem",
  APP_BASE_URL: "https://127.0.0.1:3445",
};

describe("mockIssuerOptionsFromEnv", () => {
  it("reads the client, the service, the certificate and the app", () => {
    expect(mockIssuerOptionsFromEnv(base)).toMatchObject({
      clientId: "test-client",
      service: "scenote",
      tls: { cert: "/tls/cert.pem", key: "/tls/key.pem" },
      appBaseUrl: "https://127.0.0.1:3445",
    });
  });

  it("uses the ports prismtone has used when none are given", () => {
    expect(mockIssuerOptionsFromEnv(base)).toMatchObject({ port: 3404, controlPort: 3405 });
  });

  it("takes the ports from the environment", () => {
    const options = mockIssuerOptionsFromEnv({
      ...base,
      MOCK_LUMORPHIA_PORT: "3504",
      MOCK_LUMORPHIA_CONTROL_PORT: "3505",
    });
    expect(options).toMatchObject({ port: 3504, controlPort: 3505 });
  });

  it("takes the origins end-session may send the browser back to", () => {
    const options = mockIssuerOptionsFromEnv({
      ...base,
      POST_LOGOUT_REDIRECT_ORIGINS: "https://scenote.lumorphia.test:3445,https://127.0.0.1:3445",
    });
    expect(options.postLogoutRedirectOrigins).toEqual([
      "https://scenote.lumorphia.test:3445",
      "https://127.0.0.1:3445",
    ]);
  });

  it("refuses to start without a certificate", () => {
    expect(() => mockIssuerOptionsFromEnv({ ...base, MOCK_LUMORPHIA_CERT: undefined })).toThrow(
      /MOCK_LUMORPHIA_CERT/,
    );
  });

  it("refuses a service it does not know", () => {
    expect(() => mockIssuerOptionsFromEnv({ ...base, LUMORPHIA_SERVICE: "other" })).toThrow(
      /LUMORPHIA_SERVICE/,
    );
  });
});
