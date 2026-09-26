# 07 load

Date: 2026-09-06. Repo commit: `ab93833`. Host: AMD Ryzen 9 5950X, 8 vCPUs allotted, 31GB RAM,
Alpine 6.18.38-0-virt kernel, Docker 29.6.2. Images: `interop-smppload:2.5.3-49fb653` (smppload
cloned at commit `49fb653`, tag 2.5.3, built with `erlang:27.3.4.17-alpine` + a fresh `rebar3`
3.27.0 release replacing the commit's own pre-OTP-27 vendored one), `interop-dumbclient:de0334b`
(vponomarev/libsmpp cloned at commit `de0334b`, built with `golang:1.26.8-alpine3.23` on
`alpine:3.23.5`), `nicolaka/netshoot:v0.16` (capture sidecar and tshark), `node:24.18.0-bookworm-slim`
(test runner, from the root `compose.yaml`).

## Setup

### smppload: builds, binds, then puts a corrupted PDU on the wire - blocked

Issue #8 (rebar3/BEAM load errors) is real but resolved in minutes: the commit's own vendored
`./rebar3` escript predates OTP 27 and fails to load under it
(`please re-compile this module with an Erlang/OTP 27 compiler`). Replacing it with a fresh rebar3
3.27.0 release before `make escriptize` fixes the build outright - no further patching needed, and
`git://` dependency URLs in `rebar.config` resolved fine once rewritten to `https://` (a one-line
`git config --global url.insteadOf`).

The built escript is not usable against any SMSC, though: every `bind_transceiver` it sends is two
octets short of what its own `command_length` declares. Captured with a raw tshark sidecar against
`ukarim/smscsim:0.2.0` (independent of both this library and smppload's own logging):

```
002a000000090000000000000001736d7070636c69656e74310070617373776f7264000050010100
```

40 octets on the wire, but `command_length` (the first 4 octets, if the PDU were whole) would need
to read `0000002a` (42) for a `system_id` "smppclient1" / password "password" bind - the actual
first two octets of that field are simply missing, so the wire instead starts `002a0000`
(2,752,512) with `command_id` and everything after shifted two octets early. tshark's own SMPP
dissector does not recognise the stream as SMPP at all (`-Y smpp` matches zero frames, though the
raw capture has the SYN/ACK/PSH/FIN sequence and the 40-octet data frame) - a second, independent
confirmation this is not merely a framing quirk our own codec is stricter about.

Traced as far as `oserl`'s `smpp_pdu_syntax:pack/2` (the `trx_deadlock_fix_1` branch smppload's
`rebar.config` pins), which builds the header as plain 32-bit bit-syntax
(`<<Len:32, CmdId:32, 0:32, SeqNum:32>>`) - correct on inspection, so the corruption happens
somewhere between that call and the socket write, not chased further given the time-box. Reproduced
Re-examined 2026-09-20 to see whether it could be unblocked for the throughput comparison in
`benchmarks/`. Four things are now established, and one earlier suspicion is ruled out:

- **It is one write, not a split one.** A raw listener that accumulates every chunk rather than
  reading the first receives `40 octets across 1 chunks`, byte-identical to the 2026-09-06 capture,
  with `command_length` reading 2,752,512. So the two leading zero octets are absent from the socket
  write itself; nothing about our framing or the capture is involved.
- **The compiled `pack/2` is correct**, checked in the built tree rather than the repository:
  `Len = size(BodyBin) + 16` written as `<<Len:32, CmdId:32, 0:32, SeqNum:32>>`, returned as the
  iolist `[Header, BodyBin]`. For this bind that is 16 + 26 = 42.
- **The remaining suspect is `smpp_session.erl:158`**, which writes with `erlang:port_command/2`
  rather than `gen_tcp:send/2` — an undocumented fast path in oserl code that predates OTP 27.
- **That suspect is untested.** Two attempts to swap it were both invalidated by rebar3 dep caching:
  editing a fetched dependency's source does not rebuild its beam, and the `_checkouts/` route
  re-verifies every dependency, which needs network and git in the build container. Whoever picks
  this up should patch before the first compile, or force the dep to rebuild, and confirm the beam
  actually changed before believing a result.

Enough for an upstream report — a reproducer needing no SMSC, the exact octets, and a named
suspect — but not enough for a patch, since the one-line candidate has never actually run.

Recorded as **blocked**; `smppload.test.ts`
keeps a live reproducer asserting what our server does when it receives it (refuses the stream as
unframeable - see Scenarios) rather than removing the peer. `smpp-dumb-client` covers S9, and
substitutes for S6 and (partially) S8 - see below.

### smpp-dumb-client: builds and interoperates cleanly

No build friction. Two binaries from the same pinned source: `smpp-dumb-client` (unmodified) and
`smpp-dumb-client-noping` (its two `enquireSender()` call sites in `smpp.go` commented out at build
time), the second built because every load tool built for this phase sends `enquire_link` on its
own otherwise (`smpp-dumb-client` every 10s, unconditionally, not configurable) and smppload - the
one peer that genuinely never does - is blocked, leaving S6 with no peer at all otherwise.

One integration snag, not a build one: `smpp.remote` in `config.yml` is fed straight into
`net.ParseIP` (`hdr.go`) with no DNS resolution at all, so the compose service name cannot appear
there directly. Fixed in the entrypoint: every `conf/*.yml` carries a `NODE_HOST` placeholder,
resolved with `getent hosts` and substituted into a writable copy before the real binary starts.

The four scenarios share one network namespace, owned by `dumbclient-netns`, a container that
never exits - they are pure outbound clients with nothing of their own listening, so the only shared
cost is a source IP, and one capture sidecar sees all four conversations with `node:2775` the same
way `compose.kannel.yaml`'s does for its four bearerbox variants.

Runs 1 and 2 had `dumbclient-w2000` own the namespace. It exits once it has sent its 20,000, which
took every other client's network with it: the soak's responses stopped arriving, and its log filled
with `Expired TX packet` lines (`libsmpp`'s 7000ms `TX_MAX_TIMEOUT_MS`). Those runs read that as the
peer's own window bookkeeping stalling; run 3 (2026-09-26), with the namespace owned by a container
that outlives them all, reached 173,820 soak messages in 300s where run 2 reached 22,440. The soak
stays bounded by wall-clock (5 minutes), asserting every arrival answered, nothing duplicated, and
the memory shape.

One test-harness bug found and fixed between the two runs below, not a library defect: the S6 test's
first version attached its `session.on('close', ...)` listener lazily inside the test body, after
already waiting on the S9 assertions (which can run for the better part of a minute) - by the time
the S6 test ran, the idle session had already closed, and an `EventEmitter` never replays a past
event to a listener added after it fired. Fixed by attaching every session's `close` listener at
`session`-creation time, recording it in the same per-scenario stats every other assertion reads.

Three runs of `./interop-tests/run.py dumbclient`. Run 1 (the original 300,000-count soak) surfaced
the S6 harness bug above; run 2 fixed it; run 3, with the namespace owner above and the held-message
throttle in `src/`, is the one Scenarios reports. The capture figures below are run 2's. `smppload.test.ts` passed on every run it was given (three, across the investigation
above); its one scenario needs no repeat - a second run reproduces the identical corrupted PDU,
adding nothing.

```
dumbclient run 2: frames 111300, bind_transceiver 4/4, enquire_link 12 (enquire_link_resp 9 - the
                   capture stops moments after the test does, catching some requests before their
                   response), submit_sm 62441, submit_sm_resp 48830, malformed 0, expert errors 0
smppload:          frames 0 (tshark's own SMPP dissector does not recognise the corrupted stream at all)
```

`submit_sm_resp` reads lower than `submit_sm` in the capture for the same reason
`enquire_link_resp` does - the sidecar is stopped right after the test file's own `after()` hook
finishes, which is itself moments after the last response goes out, so a handful of writes land
after the capture stops seeing them. Not a lost response: `submit_sm` (62441) matches the sum of
every session's own `arrived` exactly, and every session's own `answered` matches its `arrived` too
(see Scenarios) - both counted independently, in the server process, of anything on the wire.

## Throughput and memory

Run 3. `dumb-w500` ran to its full 20,000 in ~44s against a handler serialised to answer roughly
one message every 2ms (`SLOW_HANDLER_DELAY_MS`), `peakOutstanding` exactly 500. `dumb-w2000`, run
concurrently, held exactly 1000 and was throttled for the rest.

The soak (fast, immediate-response handler; window 100) reached 173,820 `submit_sm` over its fixed
300s, about 580/s, `peakOutstanding` 15. Sampled every 5s across the whole run (69 samples over
340s, all four scenarios combined, the harness's own per-message bookkeeping included): rss
first=165MiB, min=165MiB, max=298MiB, last=298MiB, heapUsed at the last sample 81MiB.

## Scenarios (PLAN.md)

| Id | Result | Evidence |
| --- | --- | --- |
| S6 (idleTimeout, no peer ever pings) | pass | `dumbclient.test.ts` "S6 - idle peer..." - dropped at idleTimeout, `linkTimers - closing an idle peer` logged, no response past the one owed |
| S8 (throughput, long messages, receipts) | blocked (smppload) / partial substitute | smppload's own scenario is blocked - see Setup. The soak below gives a genuine submit_sm/s figure without long messages or receipts, which `smpp-dumb-client` does not support (`research/esme-clients-and-validators.md` section B) |
| S9 (bounded window) | pass | Run 3: `dumbclient.test.ts` "S9 - bounded window..." - window 500 20,000/20,000 answered in ~44s, `peakOutstanding` exactly 500; window 2000 5,639 answered and 14,361 throttled, in arrival order, no duplicate ids |
| Backpressure at the server | pass | Run 3: window 2000 holds exactly 1000 (`maxHeldMessages`, session-options.ts) and the rest is answered `ESME_RTHROTTLED`; smpp-dumb-client counts a throttled message as sent and never resends it; window 500 is never throttled |
| Long soak | pass | Run 3: `dumbclient.test.ts` "Long soak" - 173,820 arrived, 173,820 answered, 0 duplicates, 0 unanswered errors, `close()` drains with no error; rss 165MiB first, 298MiB max and last, heapUsed 81MiB last |
| smppload bind corruption (not in PLAN.md - found this phase) | blocked | `smppload.test.ts` - our server refuses the unreadable stream instead of hanging |

## Defects in @larvit/smpp

None found. `smppload.test.ts`'s own scenario is smppload's defect, not ours: our server's reaction
(refusing the stream as unframeable, per the decision in the root `AGENTS.md`, "A stream this
library cannot frame...") is the documented behaviour working exactly as designed against a peer
that never gets as far as a readable PDU.

## Peer quirks

- **smppload's `bind_transceiver` is corrupted on the wire** - see Setup. Not chased past `oserl`'s
  `pack/2` (which is correct on inspection) given the time-box.
- **`smpp-dumb-client` treats `ESME_RTHROTTLED` as final** - a throttled message counts as sent
  and is never resubmitted. Its `enquire_link`
  interval (10s once bound as an ESME) is also hardcoded (`smpp.go`, `enquireSender(10)`), not
  exposed through `config.yml` at all - the no-ping binary built for S6 patches the call site out
  rather than configuring it.
- **`smpp.remote` takes a literal IP, never a hostname** (`net.ParseIP`, no DNS resolution) - see
  Setup.

## Open questions

- Whether smppload's bind corruption is in `oserl`'s `gen_esme_session`/`smpp_session` send path
  (not reached, given the time-box) or something specific to this build's dependency versions.
