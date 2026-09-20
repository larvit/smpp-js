# Changelog

## Unreleased

- `client()` now bounds each connect attempt at 10 seconds, the TLS handshake included, and reports
  one that expires as an ordinary connect failure, so `reconnect` retries it on its usual backoff.
  A connect previously waited the operating system out, around 130 s on Linux against a host that
  drops SYNs. `connectTimeout` retunes the bound, and `connectTimeout: false` restores the old wait.

## 0.5.0

The TypeScript rewrite. What a 0.4.0 consumer has to change is in
[MIGRATION.md](https://gitea.larvit.se/larvit/smpp-js/src/branch/main/MIGRATION.md).
