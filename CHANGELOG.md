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
- A non-finite number — `NaN`, `Infinity`, `-Infinity` — is refused where a text field on the wire
  takes one. `sendSms({ from: NaN })` put the literal sender `NaN` on the wire and resolved as a
  successful send; `message_id`, `source_addr` and the string TLVs took such a number the same way.
  The call now resolves with `err` naming the field — `from: Expected a finite number, got NaN` — so
  a caller that reads only `smsIds` meets a failure it has not met before. A whole number in an
  address or an id still spells its digits, so `message_id: 123` is unchanged. The integer fields
  name a refused `NaN` too, where the refusal used to read `null`.
- An `alert_notification` or an `outbind` from the peer is logged and left unanswered, as SMPP 3.4
  gives neither a response. Each one used to emit `sessionError`, `"alert_notification" has no
  response command`.
- `maxOctets` charges each held segment 1000 octets beyond its own, 300 more per TLV on it, and 300
  per occurrence of a repeatable one. Segments of empty fields or thousands of empty TLVs used to
  count as next to nothing, so a peer could hold far more than the cap. **Raise a `maxOctets` you
  tuned low**: it now holds several times fewer segments, and an incomplete message evicted over
  the cap is lost, since its segments were already answered.
- `server()` refuses a `maxOctets` below 1 or not a whole number, `Infinity` included, like its
  other limits. `server({ maxOctets: 0 })` used to start and then refuse every multipart message.
- `callback_num`, `callback_num_atag`, `callback_num_pres_ind`, `broadcast_area_identifier` and
  `broadcast_error_status`, the TLVs SMPP allows more than once in a PDU, keep every occurrence in
  wire order. A PDU carrying two of one used to keep only the last.

  **Reading one of these now needs an index.** `pduObj.tlvs.callback_num?.tagValue` is a `Buffer[]`
  even where one arrived (a `number[]` for `callback_num_pres_ind` and `broadcast_error_status`), so a
  `Buffer.isBuffer()` or `typeof` check written for 0.5.0 now reads it as absent. Read `tagValue[0]`
  for the first occurrence. `objToPdu()`, `session.send()` and `session.sendReturn()` take
  `{ tagValue: [value] }` for them and refuse a lone value before anything goes out.
- `cmds.broadcast_sm_resp.tlvMap` is removed; nothing read it.

## 0.5.0

The TypeScript rewrite. What a 0.4.0 consumer has to change is in
[MIGRATION.md](https://gitea.larvit.se/larvit/smpp-js/src/branch/main/MIGRATION.md).
