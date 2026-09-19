# Changelog

What changed for someone using `@larvit/smpp`, newest first.

## Unreleased

- `client()` takes `connectTimeout`, which gives up on a connect the SMSC never completes — the TLS
  handshake included — and reports it as an ordinary connect failure, so `reconnect` retries it on
  its usual backoff. Leave it out and the wait is the operating system's, as before.
