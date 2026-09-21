# Changelog

## 0.6.0 (unreleased)

- `client()` now bounds each connect attempt at 10 seconds, the TLS handshake included, and reports
  one that expires as an ordinary connect failure, so `reconnect` retries it on its usual backoff.
  A connect previously waited the operating system out, around 130 s on Linux against a host that
  drops SYNs. `connectTimeout` retunes the bound, and `connectTimeout: false` restores the old wait.
- Addresses, ids and every other text field on the wire are read and written as latin1. A
  `source_addr` of `Kaffeé` previously reached the application as `Kaffei`, because the codec wrote
  the octet and then masked bit 7 reading it back; `destination_addr`, `system_id`, `message_id`,
  `service_type` and the C-Octet String TLVs were affected the same way. A character past `U+00FF`
  in one of those fields is now refused, where it used to go out as its low octet.

## 0.5.0

The TypeScript rewrite. What a 0.4.0 consumer has to change is in
[MIGRATION.md](https://gitea.larvit.se/larvit/smpp-js/src/branch/main/MIGRATION.md).
