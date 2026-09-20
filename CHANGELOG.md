# Changelog

## Unreleased

- `client()` takes `connectTimeout`, which gives up on a connect attempt the SMSC never completes —
  the TLS handshake included — and reports it as an ordinary connect failure, so `reconnect` retries
  it on its usual backoff. Leave it out and each attempt waits the operating system out, as before.

## 0.5.0

The TypeScript rewrite. What a 0.4.0 consumer has to change is in
[MIGRATION.md](https://gitea.larvit.se/larvit/smpp-js/src/branch/main/MIGRATION.md).
