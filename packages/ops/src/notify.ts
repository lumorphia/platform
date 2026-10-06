/** 運営への通知 (lumorphia/prismtone の RM-24 から移した)。Discord webhook が本番、テストは FakeNotifier */
export type Notification = {
  level: "info" | "warn";
  title: string;
  lines: string[];
};

export interface Notifier {
  send(notification: Notification): Promise<void>;
}

const DISCORD_CONTENT_MAX = 2000;

/** 先頭にサービス名と重さを付ける。Discord の content は 2000 文字まで。超える分は切って … を付ける */
export function formatDiscordContent(service: string, n: Notification): string {
  const text = [`[${service}] ${n.level.toUpperCase()} ${n.title}`, ...n.lines].join("\n");
  return text.length <= DISCORD_CONTENT_MAX ? text : `${text.slice(0, DISCORD_CONTENT_MAX - 1)}…`;
}

export type DiscordWebhookNotifierOptions = {
  /** 通知の先頭に付けるサービス名 (prismtone、scenote など)。同じチャンネルに複数のサービスが送るときに見分ける */
  service: string;
  webhookUrl: string;
  fetchImpl?: typeof fetch;
};

/** Discord の webhook に 1 通投げる。失敗は例外にして、呼び出し側がログに残す */
export class DiscordWebhookNotifier implements Notifier {
  private readonly service: string;
  private readonly webhookUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: DiscordWebhookNotifierOptions) {
    this.service = options.service;
    this.webhookUrl = options.webhookUrl;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async send(notification: Notification): Promise<void> {
    const res = await this.fetchImpl(this.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: formatDiscordContent(this.service, notification) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`discord webhook failed: ${res.status}`);
  }
}

/** 送り先が無いときの既定。ログにだけ残す */
export class LogNotifier implements Notifier {
  private readonly log: (n: Notification) => void;

  constructor(log: (n: Notification) => void) {
    this.log = log;
  }
  async send(notification: Notification): Promise<void> {
    this.log(notification);
  }
}

/** テスト用。送ったものを覚えておく */
export class FakeNotifier implements Notifier {
  readonly sent: Notification[] = [];
  async send(notification: Notification): Promise<void> {
    this.sent.push(notification);
  }
}
