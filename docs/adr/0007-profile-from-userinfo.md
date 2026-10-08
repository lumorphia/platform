# ADR-0007: 表示名とアイコンを UserInfo から渡し、handle を表示名に使わない

| 項目     | 内容       |
| -------- | ---------- |
| Status   | Accepted   |
| Date     | 2026-10-09 |
| Deciders | t1nyb0x    |

## Context

ADR-0005 の auth-client 1.0.0 は、Better Auth の利用者の `name` に `handle` を入れていた。accounts の ADR-0002 では表示名とアイコンは Lumorphia で 1 つと決めていて、prismtone ADR-0052 では、サービスはそれを写して表示し、ログインのたびに新しくすると決めた。accounts は `profile` scope の UserInfo で標準の `name` と `picture` (accounts の R2 の公開 URL) を返している。

## Decision

- `parseLumorphiaProfile` で UserInfo の `name` と `picture` を検証し、`VerifiedLogin.profile` として渡す。Better Auth の利用者の `name` は表示名、`image` はアイコンにする。`handle` は `claims.handle` のまま
- 表示名とアイコンは **UserInfo からだけ**読む。ログインのときの最新の値で、写しの元として正しいため。ID トークンの検証 (`parseLumorphiaClaims`) は変えない
- `name` は空でない文字列を必須にする。`picture` は無ければ `null`。サービスがそのまま `img` に入れるので、https の URL 以外は拒否してログインを失敗させる

## Consequences

サービスは `login.profile` を自分の利用者の写しに書けばよい。1.0.0 から `name` の中身が handle から表示名に変わるが、1.0.0 を使うサービスはまだ無いので minor (1.1.0) とする。

## References

- [ADR-0005](0005-auth-client-boundary.md)
- lumorphia/accounts ADR-0002、lumorphia/prismtone ADR-0052
