import { Writable } from "node:stream";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createLogger, loggerOptions } from "./logger.ts";

/** ロガーが書いた行を JSON で集める */
function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      lines.push(JSON.parse(String(chunk)) as Record<string, unknown>);
      done();
    },
  });
  return { lines, stream };
}

describe("loggerOptions", () => {
  it("hides the authorization and cookie request headers", () => {
    const { lines, stream } = capture();
    pino(loggerOptions(), stream).info({
      req: {
        headers: { authorization: "Bearer test-token", cookie: "s=test-cookie", accept: "*/*" },
      },
    });
    expect(lines[0]).toMatchObject({
      req: { headers: { authorization: "[redacted]", cookie: "[redacted]", accept: "*/*" } },
    });
  });

  it("hides the set-cookie response header", () => {
    const { lines, stream } = capture();
    pino(loggerOptions(), stream).info({ res: { headers: { "set-cookie": "s=test-cookie" } } });
    expect(lines[0]).toMatchObject({ res: { headers: { "set-cookie": "[redacted]" } } });
  });

  it("hides tokens, secrets and passwords one level down", () => {
    const { lines, stream } = capture();
    pino(loggerOptions(), stream).info({
      account: {
        token: "test-token",
        secret: "test-secret",
        password: "test-password",
        accessToken: "test-access",
        refreshToken: "test-refresh",
        name: "visible",
      },
    });
    expect(lines[0]).toMatchObject({
      account: {
        token: "[redacted]",
        secret: "[redacted]",
        password: "[redacted]",
        accessToken: "[redacted]",
        refreshToken: "[redacted]",
        name: "visible",
      },
    });
  });

  it("lets the caller override the level", () => {
    expect(loggerOptions({ level: "silent" }).level).toBe("silent");
  });
});

describe("createLogger", () => {
  it("names the logger", () => {
    expect(createLogger("worker", { level: "silent" }).bindings()).toMatchObject({
      name: "worker",
    });
  });
});
