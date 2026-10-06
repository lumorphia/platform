import { describe, expect, it, vi } from "vitest";
import {
  DiscordWebhookNotifier,
  FakeNotifier,
  formatDiscordContent,
  LogNotifier,
  type Notification,
} from "./notify.ts";

const notification: Notification = {
  level: "warn",
  title: "日次レポート 2026-09-19",
  lines: ["投稿 12 / 利用者 3", "削除 SLA 違反: 1 件"],
};

describe("formatDiscordContent", () => {
  it("prefixes the title with the service and the level and joins the lines", () => {
    expect(formatDiscordContent("scenote", notification)).toBe(
      "[scenote] WARN 日次レポート 2026-09-19\n投稿 12 / 利用者 3\n削除 SLA 違反: 1 件",
    );
  });

  it("keeps within Discord's 2000 character limit", () => {
    const long = { ...notification, lines: Array.from({ length: 200 }, () => "x".repeat(50)) };
    const content = formatDiscordContent("scenote", long);
    expect(content.length).toBeLessThanOrEqual(2000);
    expect(content.endsWith("…")).toBe(true);
  });
});

describe("DiscordWebhookNotifier", () => {
  it("posts the content as JSON to the webhook", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const notifier = new DiscordWebhookNotifier({
      service: "prismtone",
      webhookUrl: "https://discord.example/hook",
      fetchImpl,
    });
    await notifier.send(notification);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://discord.example/hook");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      content: formatDiscordContent("prismtone", notification),
    });
  });

  it("throws on a non-2xx answer so the caller can log it", async () => {
    const fetchImpl = vi.fn(async () => new Response("rate limited", { status: 429 }));
    const notifier = new DiscordWebhookNotifier({
      service: "prismtone",
      webhookUrl: "https://discord.example/hook",
      fetchImpl,
    });
    await expect(notifier.send(notification)).rejects.toThrow(/429/);
  });
});

describe("FakeNotifier", () => {
  it("records what was sent", async () => {
    const fake = new FakeNotifier();
    await fake.send(notification);
    expect(fake.sent).toEqual([notification]);
  });
});

describe("LogNotifier", () => {
  it("hands the notification to the log function", async () => {
    const seen: Notification[] = [];
    await new LogNotifier((n) => seen.push(n)).send(notification);
    expect(seen).toEqual([notification]);
  });
});
