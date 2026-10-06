import { describe, expect, it } from "vitest";
import {
  sanitizeSentryBreadcrumb,
  sanitizeSentryErrorEvent,
  sanitizeSentrySpan,
  sanitizeSentryTraceContext,
  sanitizeSentryTransactionEvent,
  sentryRouteGroup,
} from "./sentry.ts";

describe("sentryRouteGroup", () => {
  it("URLを個人や秘密を含まないルート群に丸める", () => {
    expect(sentryRouteGroup("https://app.example/posts/secret-id?token=x#reply")).toBe("/posts");
    expect(sentryRouteGroup("/api/posts/secret-id?token=x")).toBe("/api/posts");
  });

  it("空・不正なURLを送信対象にしない", () => {
    expect(sentryRouteGroup(undefined)).toBeUndefined();
    expect(sentryRouteGroup(123)).toBeUndefined();
    expect(sentryRouteGroup("")).toBeUndefined();
    expect(sentryRouteGroup("http://[")).toBeUndefined();
  });

  it("ルート自身はそのまま分類に使う", () => {
    expect(sentryRouteGroup("/")).toBe("/");
    expect(sentryRouteGroup("/api")).toBe("/api");
  });
});

describe("sanitizeSentryBreadcrumb", () => {
  it("画面遷移はルート群だけを残す", () => {
    expect(
      sanitizeSentryBreadcrumb({
        category: "navigation",
        timestamp: 1,
        data: {
          from: "/settings?token=secret",
          to: "/posts/private-id?draft=1",
          secret: "value",
        },
      }),
    ).toEqual({
      category: "navigation",
      timestamp: 1,
      data: { from: "/settings", to: "/posts" },
    });
  });

  it("HTTP通信はmethodとstatusとルート群だけを残す", () => {
    expect(
      sanitizeSentryBreadcrumb({
        type: "http",
        category: "fetch",
        data: {
          method: "post",
          status_code: 500,
          url: "https://app.example/api/posts/private-id?token=secret",
          request_body: "private",
        },
      }),
    ).toEqual({
      type: "http",
      category: "fetch",
      data: { method: "POST", status_code: 500, route: "/api/posts" },
    });
  });

  it("consoleとDOM操作のbreadcrumbは破棄する", () => {
    expect(sanitizeSentryBreadcrumb({ category: "console", message: "secret" })).toBeNull();
    expect(
      sanitizeSentryBreadcrumb({ category: "ui.click", message: "private button" }),
    ).toBeNull();
  });

  it("遷移元か遷移先だけでも安全な分類を残す", () => {
    expect(
      sanitizeSentryBreadcrumb({ category: "navigation", data: { from: "/settings/private" } }),
    ).toEqual({ category: "navigation", data: { from: "/settings" } });
    expect(
      sanitizeSentryBreadcrumb({ category: "navigation", data: { to: "/posts/private" } }),
    ).toEqual({ category: "navigation", data: { to: "/posts" } });
    expect(sanitizeSentryBreadcrumb({ category: "navigation" })).toEqual({
      category: "navigation",
    });
  });

  it("欠損したHTTP属性を秘密を推測せず空のdataにする", () => {
    expect(
      sanitizeSentryBreadcrumb({
        category: "xhr",
        level: "error",
        data: { method: 123, status_code: "500", url: "http://[" },
      }),
    ).toEqual({ category: "xhr", level: "error", data: {} });
    expect(sanitizeSentryBreadcrumb({ type: "http" })).toEqual({ type: "http", data: {} });
  });
});

describe("sanitizeSentryTraceContext", () => {
  it("traceの識別情報だけを残す", () => {
    expect(
      sanitizeSentryTraceContext({
        trace_id: "trace-1",
        span_id: "span-1",
        parent_span_id: "span-0",
        op: "http.server",
        status: "internal_error",
        data: { token: "secret" },
        tags: { user: "private" },
      }),
    ).toEqual({
      trace_id: "trace-1",
      span_id: "span-1",
      parent_span_id: "span-0",
      op: "http.server",
      status: "internal_error",
    });
  });

  it("識別子が欠けたtraceを破棄する", () => {
    expect(sanitizeSentryTraceContext(undefined)).toBeUndefined();
    expect(sanitizeSentryTraceContext("trace")).toBeUndefined();
    expect(sanitizeSentryTraceContext({ trace_id: "trace-1" })).toBeUndefined();
    expect(sanitizeSentryTraceContext({ trace_id: 1, span_id: "span-1" })).toBeUndefined();
  });
});

describe("sanitizeSentrySpan", () => {
  it("DB spanからSQLと値を除去する", () => {
    expect(
      sanitizeSentrySpan({
        trace_id: "trace-1",
        span_id: "span-1",
        start_timestamp: 1,
        timestamp: 2,
        op: "db.query",
        description: "select * from users where email = 'secret@example.com'",
        data: { "db.system": "postgresql", "db.statement": "private sql" },
      }),
    ).toEqual({
      trace_id: "trace-1",
      span_id: "span-1",
      start_timestamp: 1,
      timestamp: 2,
      op: "db.query",
      description: "database",
      data: { "db.system": "postgresql" },
    });
  });

  it("HTTP spanはmethod・status・ルート群だけを残す", () => {
    expect(
      sanitizeSentrySpan({
        op: "http.client",
        description: "GET https://app.example/api/posts/private?token=secret",
        data: {
          "http.method": "get",
          "http.status_code": 503,
          "url.full": "https://app.example/api/posts/private?token=secret",
          "http.request.header.authorization": "Bearer secret",
        },
      }),
    ).toEqual({
      op: "http.client",
      description: "GET /api/posts",
      data: { "http.method": "get", "http.status_code": 503, route: "/api/posts" },
    });
  });

  it("resourceとnavigationの説明をルート群に丸める", () => {
    expect(
      sanitizeSentrySpan({
        op: "resource.script",
        description: "https://app.example/assets/private.js?token=secret",
      }),
    ).toEqual({ op: "resource.script", description: "/assets", data: {} });
    expect(
      sanitizeSentrySpan({
        op: "navigation",
        description: "https://app.example/settings/private?token=secret",
      }),
    ).toEqual({ op: "navigation", description: "/settings", data: {} });
  });

  it("分類できないspanの任意説明を固定値へ置き換える", () => {
    expect(sanitizeSentrySpan({ op: "ui.render", description: "private component" })).toEqual({
      op: "ui.render",
      description: "ui.render",
      data: {},
    });
    expect(sanitizeSentrySpan({ description: "private operation" })).toEqual({
      description: "operation",
      data: {},
    });
    expect(sanitizeSentrySpan({})).toEqual({ data: {} });
  });
});

describe("sanitizeSentryErrorEvent", () => {
  it("不正なbreadcrumbと許可されていないtagを破棄しReplay IDだけを残す", () => {
    expect(
      sanitizeSentryErrorEvent(
        {
          message: "boom",
          tags: { private: "secret" },
          breadcrumbs: [null, "invalid", { category: "console", message: "secret" }],
          contexts: {
            trace: { trace_id: "missing-span" },
            replay: { replay_id: "replay-1", private: "secret" },
          },
        },
        ["runtime"],
      ),
    ).toEqual({ message: "boom", contexts: { replay: { replay_id: "replay-1" } } });
  });

  it("不正なtagとcontextを追加しない", () => {
    expect(
      sanitizeSentryErrorEvent(
        { message: "boom", tags: "invalid", contexts: { replay: { replay_id: 123 } } },
        ["runtime"],
      ),
    ).toEqual({ message: "boom" });
  });
});

describe("sanitizeSentryTransactionEvent", () => {
  it("traceからリクエストとSQLを除きルート群と時間を残す", () => {
    expect(
      sanitizeSentryTransactionEvent(
        {
          type: "transaction",
          transaction: "/posts/private-id?token=x",
          start_timestamp: 1,
          timestamp: 2,
          request: { data: "private" },
          contexts: {
            trace: { trace_id: "trace-1", span_id: "span-1", data: { token: "secret" } },
          },
          spans: [
            {
              trace_id: "trace-1",
              span_id: "span-2",
              start_timestamp: 1,
              timestamp: 2,
              op: "db.query",
              description: "select * from users where email = 'secret@example.com'",
              data: { "db.system": "postgresql", "db.statement": "private sql" },
            },
          ],
        },
        ["runtime"],
      ),
    ).toEqual({
      type: "transaction",
      transaction: "/posts",
      start_timestamp: 1,
      timestamp: 2,
      contexts: { trace: { trace_id: "trace-1", span_id: "span-1" } },
      spans: [
        {
          trace_id: "trace-1",
          span_id: "span-2",
          start_timestamp: 1,
          timestamp: 2,
          op: "db.query",
          description: "database",
          data: { "db.system": "postgresql" },
        },
      ],
    });
  });

  it("不正なspanを除き許可tagとReplay IDだけを残す", () => {
    expect(
      sanitizeSentryTransactionEvent(
        {
          transaction: "/",
          tags: { runtime: "browser", private: "secret" },
          contexts: { replay: { replay_id: "replay-1" } },
          spans: [null, "invalid", { op: "task", description: "private" }],
        },
        ["runtime"],
      ),
    ).toEqual({
      transaction: "/",
      tags: { runtime: "browser" },
      contexts: { replay: { replay_id: "replay-1" } },
      spans: [{ op: "task", description: "task", data: {} }],
    });
  });
});
