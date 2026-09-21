# Changelog

## 0.6.0 (unreleased)

- `client()` now bounds each connect attempt at 10 seconds, the TLS handshake included, and reports
  one that expires as an ordinary connect failure, so `reconnect` retries it on its usual backoff.
  A connect previously waited the operating system out, around 130 s on Linux against a host that
  drops SYNs. `connectTimeout` retunes the bound, and `connectTimeout: false` restores the old wait.
- Addresses, ids and every other text field on the wire are read and written as latin1. A
  `source_addr` of `Kaffeé` previously reached the application as `Kaffei`, because the codec wrote
  the octet and then masked bit 7 reading it back; `destination_addr`, `system_id`, `message_id`,
  `password`, `service_type` and the C-Octet String TLVs were affected the same way. A character past
  `U+00FF` in one of those fields is now refused, where it used to go out as its low octet.

  **A server comparing `systemId` or `password` could be impersonated.** Masking bit 7 folded 127 of
  the 255 non-zero octets onto a character a low octet also reaches, so the bind credentials your
  `authenticate` received were not unique to the octets the peer sent: one refused as `admin` could
  bind as `\xE1dmin` and match the same string. latin1 is one-to-one over the octets, so two
  different wire values no longer arrive as one. Read 0.5.0 bind logs for a `systemId` you did not
  issue.

  **Check what you stored before you roll this out.** Values your application persisted under 0.5.0
  were read with bit 7 masked, so an address or a `message_id` carrying an octet above `0x7F` is
  spelled differently now: a stored id will not match the receipt it belongs to, and a stored address
  will not match the sender it came from. Ids most SMSCs issue are digits or hex and are unaffected.
- A `U+0000` inside a C-Octet String — `source_addr`, `message_id`, `system_id` and the rest — is
  refused. An Octet String carries a NULL as before.

## 0.5.0

The TypeScript rewrite. What a 0.4.0 consumer has to change is in
[MIGRATION.md](https://gitea.larvit.se/larvit/smpp-js/src/branch/main/MIGRATION.md).
