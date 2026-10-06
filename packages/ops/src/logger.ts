// pino のロガー。シークレットをログに出さない (lumorphia/prismtone の docs/design/10 §2 から移した)。Node 専用
import { pino, type Logger, type LoggerOptions } from "pino";

// 伏せるパス。リクエストの認証情報と、1 段下の token / secret / password
export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
  "*.token",
  "*.secret",
  "*.password",
  "*.accessToken",
  "*.refreshToken",
];

export function loggerOptions(overrides: LoggerOptions = {}): LoggerOptions {
  return {
    level: process.env.LOG_LEVEL ?? "info",
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    ...overrides,
  };
}

export function createLogger(name: string, overrides: LoggerOptions = {}): Logger {
  return pino(loggerOptions({ name, ...overrides }));
}

export type { Logger };
