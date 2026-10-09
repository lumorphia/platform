# ADR の一覧

| 番号                                               | 決めたこと                                              |
| -------------------------------------------------- | ------------------------------------------------------- |
| [0001](0001-record-architecture-decisions.md)      | ADR を使う                                              |
| [0002](0002-repository-scope-and-publishing.md)    | public の monorepo に置き、パッケージごとの版で公開する |
| [0003](0003-sign-content-type-in-presigned-put.md) | 署名付き PUT の URL に content-type を署名する          |
| [0004](0004-ops-scope.md)                          | ops にはロガー・通知・Sentry の伏せ字だけを入れる       |

| [0005](0005-auth-client-boundary.md) | サービス側の OIDC の受け口と署名検証を auth-client にまとめる |

| [0006](0006-account-event-delivery.md) | アカウント状態の署名検証とサービスの永続的な適用を分ける |

| [0007](0007-profile-from-userinfo.md) | 表示名とアイコンを UserInfo から渡し、handle を表示名に使わない |

| [0008](0008-legal-package.md) | 規約の本文と同意の版の比較を @lumorphia/legal にまとめる |

| [0009](0009-shared-dev-tooling.md) | 開発の道具は Renovate の共通の設定と CI の再利用ワークフローだけを共通にする |

本文中の「prismtone ADR-NNNN」は lumorphia/prismtone の ADR を指す。
