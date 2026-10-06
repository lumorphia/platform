/**
 * Sentry に送る前の伏せ字 (lumorphia/prismtone の packages/shared/src/monitoring から移した)。
 * 例外とスタック以外の自動収集を落とし、URL は最上位のルート群に丸める。ブラウザでもサーバーでも動く (Node API と pino を使わない)
 */
export type SentryBreadcrumbLike = {
  type?: string;
  level?: string;
  category?: string;
  message?: string;
  data?: Record<string, unknown>;
  timestamp?: number;
};

type SentrySpanLike = {
  [key: string]: unknown;
  data?: Record<string, unknown>;
  description?: string;
  op?: string;
};

const BASE_EVENT_KEYS = [
  "event_id",
  "timestamp",
  "platform",
  "level",
  "message",
  "exception",
  "release",
  "environment",
  "sdk",
  "debug_meta",
] as const;

function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(
    keys.flatMap((key) => (source[key] === undefined ? [] : [[key, source[key]]])),
  );
}

/** URLを個人や秘密を含まない最上位のルート群へ丸める。 */
export function sentryRouteGroup(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  try {
    const pathname = new URL(value, "https://sentry.invalid").pathname;
    const parts = pathname.split("/").filter(Boolean);
    if (parts.length === 0) return "/";
    if (parts[0] === "api" && parts[1]) return `/api/${parts[1]}`;
    return `/${parts[0]}`;
  } catch {
    return undefined;
  }
}

function breadcrumbBase(breadcrumb: SentryBreadcrumbLike): SentryBreadcrumbLike {
  return pick(breadcrumb as Record<string, unknown>, [
    "type",
    "level",
    "category",
    "timestamp",
  ]) as SentryBreadcrumbLike;
}

/** 画面遷移とHTTP結果だけを、入力値やURLの識別子を含まない形で残す。 */
export function sanitizeSentryBreadcrumb(
  breadcrumb: SentryBreadcrumbLike,
): SentryBreadcrumbLike | null {
  const category = breadcrumb.category;
  if (category === "navigation") {
    const from = sentryRouteGroup(breadcrumb.data?.from);
    const to = sentryRouteGroup(breadcrumb.data?.to);
    return {
      ...breadcrumbBase(breadcrumb),
      ...((from ?? to) ? { data: { ...(from ? { from } : {}), ...(to ? { to } : {}) } } : {}),
    };
  }
  if (category === "fetch" || category === "xhr" || breadcrumb.type === "http") {
    const method =
      typeof breadcrumb.data?.method === "string"
        ? breadcrumb.data.method.toUpperCase().slice(0, 16)
        : undefined;
    const statusCode =
      typeof breadcrumb.data?.status_code === "number" ? breadcrumb.data.status_code : undefined;
    const route = sentryRouteGroup(breadcrumb.data?.url);
    return {
      ...breadcrumbBase(breadcrumb),
      data: {
        ...(method ? { method } : {}),
        ...(statusCode !== undefined ? { status_code: statusCode } : {}),
        ...(route ? { route } : {}),
      },
    };
  }
  return null;
}

export function sanitizeSentryTraceContext(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const context = value as Record<string, unknown>;
  if (typeof context.trace_id !== "string" || typeof context.span_id !== "string") {
    return undefined;
  }
  return pick(context, ["trace_id", "span_id", "parent_span_id", "op", "status", "origin"]);
}

function sanitizeReplayContext(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const replayId = (value as Record<string, unknown>).replay_id;
  return typeof replayId === "string" ? { replay_id: replayId } : undefined;
}

function sanitizeContexts(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const contexts = value as Record<string, unknown>;
  const trace = sanitizeSentryTraceContext(contexts.trace);
  const replay = sanitizeReplayContext(contexts.replay);
  if (!trace && !replay) return undefined;
  return { ...(trace ? { trace } : {}), ...(replay ? { replay } : {}) };
}

function safeSpanData(span: SentrySpanLike): Record<string, unknown> {
  const data = span.data ?? {};
  const safe = pick(data, [
    "db.system",
    "http.request.method",
    "http.response.status_code",
    "http.method",
    "http.status_code",
    "sentry.op",
    "sentry.origin",
    "sentry.source",
  ]);
  const route = sentryRouteGroup(
    data["http.url"] ?? data.url ?? data["url.full"] ?? data["http.route"],
  );
  if (route) safe.route = route;
  return safe;
}

function safeSpanDescription(span: SentrySpanLike): string | undefined {
  const op = span.op;
  if (op?.startsWith("db")) return "database";
  if (op?.includes("http") || op?.startsWith("resource")) {
    const data = span.data ?? {};
    const method = data["http.request.method"] ?? data["http.method"];
    const route = sentryRouteGroup(
      data["http.url"] ?? data.url ?? data["url.full"] ?? span.description,
    );
    return (
      [typeof method === "string" ? method.toUpperCase().slice(0, 16) : undefined, route]
        .filter(Boolean)
        .join(" ") || op
    );
  }
  if (op?.startsWith("navigation")) return sentryRouteGroup(span.description) ?? op;
  return op ?? (span.description ? "operation" : undefined);
}

/** trace spanからURL、SQL、任意属性を除き、時間と処理種別だけを残す。 */
export function sanitizeSentrySpan(span: object): SentrySpanLike {
  const source = span as unknown as SentrySpanLike;
  const safe = pick(source, [
    "trace_id",
    "parent_span_id",
    "span_id",
    "start_timestamp",
    "status",
    "timestamp",
    "op",
    "origin",
    "exclusive_time",
    "is_segment",
    "segment_id",
  ]);
  const description = safeSpanDescription(source);
  if (description) safe.description = description;
  safe.data = safeSpanData(source);
  return safe;
}

function safeTags(event: Record<string, unknown>, allowedTagKeys: readonly string[]) {
  if (!event.tags || typeof event.tags !== "object") return undefined;
  const tags = pick(event.tags as Record<string, unknown>, allowedTagKeys);
  return Object.keys(tags).length > 0 ? tags : undefined;
}

export function sanitizeSentryErrorEvent<T extends object>(
  event: T,
  allowedTagKeys: readonly string[],
): Record<string, unknown> {
  const source = event as unknown as Record<string, unknown>;
  const safe = pick(source, BASE_EVENT_KEYS);
  const tags = safeTags(source, allowedTagKeys);
  if (tags) safe.tags = tags;
  if (Array.isArray(source.breadcrumbs)) {
    const breadcrumbs = source.breadcrumbs.flatMap((breadcrumb) => {
      if (!breadcrumb || typeof breadcrumb !== "object") return [];
      const sanitized = sanitizeSentryBreadcrumb(breadcrumb as SentryBreadcrumbLike);
      return sanitized ? [sanitized] : [];
    });
    if (breadcrumbs.length > 0) safe.breadcrumbs = breadcrumbs;
  }
  const contexts = sanitizeContexts(source.contexts);
  if (contexts) safe.contexts = contexts;
  return safe;
}

export function sanitizeSentryTransactionEvent<T extends object>(
  event: T,
  allowedTagKeys: readonly string[],
): Record<string, unknown> {
  const source = event as unknown as Record<string, unknown>;
  const safe = pick(source, [...BASE_EVENT_KEYS, "type", "start_timestamp", "measurements"]);
  const transaction = sentryRouteGroup(source.transaction);
  if (transaction) safe.transaction = transaction;
  const tags = safeTags(source, allowedTagKeys);
  if (tags) safe.tags = tags;
  const contexts = sanitizeContexts(source.contexts);
  if (contexts) safe.contexts = contexts;
  if (Array.isArray(source.spans)) {
    safe.spans = source.spans.flatMap((span) =>
      span && typeof span === "object" ? [sanitizeSentrySpan(span as SentrySpanLike)] : [],
    );
  }
  return safe;
}
