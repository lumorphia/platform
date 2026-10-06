# ADR-0004: ops にはロガー・通知・Sentry の伏せ字だけを入れ、機能フラグ・heartbeat・日次レポートはサービスに残す

| 項目     | 内容       |
| -------- | ---------- |
| Status   | Accepted   |
| Date     | 2026-10-06 |
| Deciders | t1nyb0x    |

## Context

lumorphia/scenote の ADR-0006 は、`@lumorphia/ops` に「ロガー、heartbeat、機能フラグ、通知 (Discord)、日次レポートの土台、Sentry の伏せ字」を入れると挙げた。lumorphia/prismtone の中身を読むと、性質が分かれていた。

| 候補            | prismtone の中身                                                    | サービスとの結び付き                                            |
| --------------- | ------------------------------------------------------------------- | --------------------------------------------------------------- |
| ロガー          | pino にシークレットを伏せる設定を付けたもの (27 行)                 | 無い                                                            |
| 通知            | Discord の webhook、ログだけ、テスト用 (60 行)                      | 先頭の `[prismtone]` だけ                                       |
| Sentry の伏せ字 | 例外とスタック以外を落とし、URL を丸める (221 行)                   | 無い。ブラウザでもサーバーでも動く                              |
| 機能フラグ      | 共通にできるのは 10 秒のキャッシュと「行が無ければ有効」(30 行ほど) | フラグの一覧、DB のテーブル、管理者の判定、モデレーションの記録 |
| heartbeat       | 1 分ごとに 1 行を書くジョブ (16 行)                                 | ジョブの定義 (pg-boss)、DB のテーブル                           |
| 日次レポート    | 集計 (387 行) と通知                                                | 集計の中身がほぼすべて prismtone の指標                         |

パッケージはサービスの DB のテーブルを持たない (scenote ADR-0006)。機能フラグと heartbeat を今パッケージにすると、テーブルやジョブの定義を外から渡す仕組みのほうが、共通にできる中身より大きくなる。

## Decision

- `@lumorphia/ops` は入口を 3 つに分ける
  - `@lumorphia/ops/logger`: pino とシークレットを伏せる設定。Node 専用
  - `@lumorphia/ops/notify`: 運営への通知 (Discord の webhook、ログだけ、テスト用)。通知の先頭にサービス名を付ける (`service` を受け取る)。同じチャンネルに複数のサービスが送っても見分けられる
  - `@lumorphia/ops/sentry`: Sentry に送る前の伏せ字。ブラウザでも動くので、Node API と pino を使わない (ESLint が止める)
- 入口は `.` を作らず、使う側が必要なものだけを読む。画面が `sentry` を読んでも pino が入らない
- **機能フラグ、heartbeat、日次レポートはサービスに残す**。Scenote で同じものを作ったときに 2 つを見比べ、共通の形がはっきりしたら切り出す

## Consequences

### 良い点

- 運用の土台のうち、サービスを知らないものだけが 1 か所になる
- ロガーが本当にシークレットを伏せることを、初めて単体テストで確かめる (prismtone ではテストが無かった)

### 悪い点・受け入れるリスク

- Scenote は、機能フラグと heartbeat を prismtone から写して始める
- 通知の作り方が変わる (`new DiscordWebhookNotifier(url)` から `new DiscordWebhookNotifier({ service, webhookUrl })`)。prismtone の載せ替えで直す

## Alternatives

- scenote ADR-0006 の一覧どおりに全部入れる: テーブルやジョブを外から渡す仕組みが要り、共通にできる中身より大きくなる
- 入口を 1 つ (`.`) にする: 画面が伏せ字を読むと pino まで入る

## References

- lumorphia/scenote ADR-0006
- lumorphia/prismtone `packages/core/src/logger.ts`、`adapters/notify/`、`packages/shared/src/monitoring/`、`domain/feature-flags.ts`、`jobs/heartbeat.ts`、`jobs/daily-report.ts`
