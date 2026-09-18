# AGENTS.md

Guidance for LLM agents working in this repository. What each file in it is for is under
[Documentation](#documentation).

## What this is

A ground-up TypeScript rewrite of `larvitsmpp` 0.4.0, published as `@larvit/smpp` 0.5.0. The branch
started from an orphan commit — no history from 0.4.0 is carried over. The 0.4.0 source is still
readable on the `v0.4.0` branch of the same repository and is the reference for protocol behaviour,
not for structure or style.

## Goals

The nine goals, in priority order, live in
[README.md](https://gitea.larvit.se/larvit/smpp-js/src/branch/main/README.md#goals) — they say where this library is heading, which an outside
reader judges it by. The README states the audience alongside them. Everything below cites a goal by
number.


## Hard rules

These are not preferences. Breaking one is a defect.

1. **Nothing throws.** Every fallible function returns (or resolves to) a DTO carrying an optional
   `err`. No `throw`, no rejected promises, no exceptions as control flow. Node APIs that throw are
   wrapped at the boundary and converted into a result. Programmer errors (bad arguments) are
   results too, wherever the types admit one: a function whose argument types are a closed set is
   guarded by the compiler and stays total, which is why the encoding helpers return plainly, and
   the check belongs at whichever boundary the argument arrives untyped at.
2. **Log messages are static strings.** Every dynamic value goes into the log metadata. Never
   interpolate, never concatenate.
   - GOOD: `log.debug('sendSms() - splitting message', { parts: msgs.length, to });`
   - BANNED: `log.debug('sendSms() - splitting into ' + msgs.length + ' parts');`
3. **No `error` event.** Node makes an unhandled `error` event throw, which would break rule 1.
   Sessions emit `sessionError`, servers emit `serverError`.
4. **No casts, no non-null assertions.** `as`, `as unknown as` and `!` are all banned. Parse untyped
   input once through a type guard at the boundary; everything past it is typed. `noUncheckedIndexedAccess`
   is on, so every lookup into a record or buffer is `T | undefined` until you handle it — that is the
   point, not an obstacle to route around.

## Architecture

```
src/
	index.ts             Public surface. Named exports only, no default export.
	client.ts            client() -> { err, session }
	server.ts            server() -> { err, server }, server owns the listener + close()
	session.ts           Session: the socket's life, dispatch, events, and the collaborators below
	sms.ts               The live handle emitted as the 'sms' event (sendResp/sendDlr)
	concat.ts            How a PDU says it is a segment: its UDH, or the sar_* TLVs
	dlr.ts               Delivery receipts: text and TLV parsing, receipt status codes
	dlr-merger.ts        DlrMerger: per-segment receipts counted into one MessageDlr
	error-from.ts        An untyped value as error material: errorFrom() an Error, namedValue() a name
	expiring-groups.ts   ExpiringGroups: the capped, expiring store both of those share
	held-messages.ts     HeldMessages: capped, expiring messages the application has not answered
	idle-waiters.ts      IdleWaiters: waiting for a count to fall to zero, and what is left of a budget
	incoming-requests.ts Every request the peer sends: messages, receipts, links, unknown commands
	link-gate.ts         LinkGate: where a request with no link to go out on waits for the next one
	link-timers.ts       LinkTimers: the enquire_link heartbeat and the idle timeout
	log.ts               SmppLog, the logger contract, and silentLog — the default
	message.ts           Encoding detection, splitting, bit counting, SMPP date formatting
	message-body.ts      Where an inbound body is: short_message, or the message_payload TLV
	outgoing-requests.ts OutgoingRequests: the gate, the window, the pending map and the retry
	pdu.ts               pduToObj / objToPdu / pduReturn — synchronous, result-returning
	pdu-framer.ts        PduFramer: a byte stream cut into complete PDUs
	pdu-refusal.ts       A PDU the codec would not read, and the answer SMPP names for it
	pdu-transport.ts     PduTransport: the socket a session reads complete PDUs off
	pending-requests.ts  PendingRequests: sequence numbers, correlation, timeout, abort
	reassembly.ts        Reassembler: capped, expiring multipart groups
	reconnect-loop.ts    ReconnectLoop: backoff, retry timer, stopped-ness
	result.ts            Result<T> — the shape every fallible call returns
	send-sms.ts          submitSms composition and the submitSmParams builder
	send-window.ts       SendWindow: the maxOutstanding semaphore
	session-options.ts   SessionOptions, ReconnectOptions, bind direction and the session defaults
	sms-id.ts            Message ids: the peer's notation, the <base>-<n> a segment gets, which response carries one
	udh.ts               User data header: its length, the concatenation fields of a long SMS and their reference
	unanswered-error.ts  UnansweredError: it went out and no answer came back
	uuid.ts              uuidv7() — the ids the library generates for messages
	defs/
		commands.ts      The 33 commands, their ids and ordered parameter lists
		constants.ts     consts + constsById, and the SMPP version constants
		encodings.ts     GSM 03.38, LATIN1, UCS2, detection, data_coding resolution
		errors.ts        errors + errorsById (ESME_*)
		tlvs.ts          TLV definitions, tlvsById, the input shape, and writing a TLV stream
		types.ts         Wire types: int8/int16/int32/string/cstring/buffer/arrays
```

Dependency direction is one way: `defs` knows nothing above it, `pdu` uses `defs`, `session` uses
`pdu`, and `client`/`server` use `session`. Nothing reaches back up.

**Parameter order is wire order.** The key order inside `cmds.*.params` is the order the fields are
written to and read from the buffer. Never sort those alphabetically — the alphabetical-ordering
convention applies everywhere else, but here it corrupts every PDU.

## Toolchain

Run everything through the container; never invoke node or npm on the host.

```bash
docker compose run --rm node npm install
docker compose run --rm node npm test
docker compose run --rm node npm run build
```

- Tests are `.ts` and run directly under Node's type stripping — no build step in the dev loop.
- Source imports use `.ts` extensions; `rewriteRelativeImportExtensions` emits `.js` into `dist`.
- `erasableSyntaxOnly` is on, so no enums, no namespaces, no parameter properties. Use `as const`
  objects plus union types.
- The published floor is Node 18, but the dev container runs Node 24 (type stripping needs it). CI
  compiles the tests and runs them on 18, every LTS above it, and current, so the floor is
  verified rather than asserted.
- `typescript` is pinned to the 6.x line because `typescript-eslint` peer-requires `<6.1.0`. Move to
  TypeScript 7 once that constraint lifts.
- GitHub mirrors Gitea through `.gitea/workflows/mirror.yaml`, which never prunes, and
  `mirror-delete.yaml`, one run per deleted ref. A delete run that fails or outlives Gitea's queue
  timeout, or a push run that cloned before the delete, leaves the ref on GitHub until the delete
  run is re-run. Accepted: a stale ref there is harmless, and refs only GitHub has must survive.
  Maintainer's call, 2026-09-14; valid while nothing deploys from GitHub.

## Defects found in 0.4.0

Every row names what 0.4.0's own code did, so it is not rebuilt here.
[MIGRATION.md](MIGRATION.md) names what changed for a consumer, and is the only place that does.
Confirmed by reading the 0.4.0 source; each row has a regression test naming the behaviour.

| Defect | 0.4.0 behaviour |
| --- | --- |
| LATIN1 never decodes | `decodeMsg` loops `consts.ENCODING` without breaking, so `data_coding` 0x03 lands on the alias `ISO_8859_1`, which has no decoder, and silently falls back to ASCII |
| Short segments | `splitMsg` accumulates a full segment then pushes `msgPart.slice(0, -1)`, so every segment is one character short: 152 GSM characters instead of 153, 66 UCS2 instead of 67. Long messages are split into more segments than they need, and each extra segment is billed |
| DLR month off by one | `smppDate()` uses `getMonth()` (0-based) without `+1`, so January renders as `00` |
| Non-standard DLR status | Receipts emit `stat:UNDELIVERABLE`; the spec's field is 7 characters (`UNDELIV`) |
| GSM 03.38 declared as IA5 | `sendSms` resolves its encoding through `consts.ENCODING`, so a GSM body goes out under `data_coding` 0x01 — SMPP 3.4 5.2.19's IA5 (CCITT T.50), where `$` and `@` are STX and NUL |
| Flash destroys UCS2 | `flash: true` overwrites `data_coding` with 0x10, discarding the UCS2 alphabet, which needs 0x18 |
| Shared concat reference | The concatenation reference counter is a module-level global shared by every session in the process |
| `send()` never times out | Each call adds a listener keyed on the sequence number; a peer that never answers leaks it and the promise never settles |
| `tls: true` is not TLS | Constructs a bare `new tls.Socket()` with no handshake instead of `tls.connect()` |
| Alphanumeric sender TON | `sendSms` hardcodes `source_addr_ton` to 1 (international) even for alphanumeric senders, which require TON 5 |
| Text-only DLRs refused | `deliver_sm` without both `message_state` and `receipted_message_id` TLVs is rejected with `ESME_RINVTLVSTREAM`, so Kannel-style receipts are unusable |
| Unbounded reassembly | Incomplete long-SMS groups are capped by nothing and swept only when other traffic arrives, after 24 hours |
| `sar_*` segmentation unread | `session.js` reassembles on the UDH alone, so a message segmented with `sar_msg_ref_num`/`sar_total_segments`/`sar_segment_seqnum` — SMPP 3.4's other spelling, and Jasmin's documented default — reaches the application one fragment per segment |
| Dead DLR aggregation | `longSmsDlrs` is allocated to merge per-segment receipts and then never used |
| Trailing NULL truncation | `types.buffer.size()` subtracts one whenever the value's last octet is `0x00`, so the PDU is allocated one octet short while `sm_length` still reports the full length. Any UCS2 message ending in a character like U+4E00 or U+3000 goes out corrupt |
| Dormant filters | `defs.filters` is declared on commands and TLVs but never invoked anywhere |
| Unchecked reads | Wire reads index straight into the buffer, so a short or malformed PDU throws out of the codec |
| Unrangechecked writes | Integer params are handed to `writeUInt8`/`writeUInt16BE` unvalidated, so an out-of-range value throws from inside Node |
| `submit_multi` missing `sm_length` | The field is commented out of the command table, so `short_message` never round-trips for that command |
| Per-parameter defaults never applied | `calcCmdLength` reads `paramType.default` (the wire type's) rather than the parameter's, so `interface_version: 0x50` on the bind commands did nothing and every bind declared version 0x00 |
| `source_telematics_id` width | Defined as a 2-octet integer; SMPP 3.4 5.3.2.8 makes it 1 octet, unlike `dest_telematics_id`, which really is 2 |
| Binary payloads decoded as text | `data_coding` 0x02, 0x04, 0x14 and 0xF4-0xF7 are 8-bit binary and land on the GSM 03.38 table, which rewrites every octet outside it |
| Binary TLVs round-trip corrupt | `pduToObj` turns a `Buffer` TLV value into a hex string (`utils.js:307`), and `objToPdu` writes that string back as its own ASCII, so `message_payload`, `network_error_code`, `callback_num` and the rest are destroyed by any round trip |
| `ESME_RINVBCASTCHANIND` typo | Defined as `0x011`, three hex digits; the spec value is `0x0112` |
| Every response carries a message id | `session.js` builds `params = {'message_id': …}` for every response it sends, `deliver_sm_resp` included; SMPP 3.4 4.6.2 makes that field unused and NULL, and Jasmin closes the connection on one |

## Multipart sends

`sendSms` puts every segment of a message on the wire together instead of waiting for each response
in turn, so a long message costs one round trip rather than one per segment. Nothing on the
receiving side forces the order either way: this library answers each inbound segment as it arrives,
so a peer that dispatches one request at a time is never left waiting on us.

## GSM 7-bit is sent unpacked

Over SMPP the ESME puts one GSM character per octet in `short_message` and the SMSC packs it into
septets. The 140-octet limit applies to that packed result, not to what goes on the wire here, which
is why a concatenated GSM segment is 153 characters plus a 6-octet UDH — 159 octets in
`short_message`, and entirely correct. Do not "fix" that to 134; that number is the packed payload
size and would truncate every long GSM message by a fifth.

GSM 7-bit is the only alphabet it applies to. What each of the three is budgeted, and why, is a
decision under [The wire](docs/decisions.md#the-wire).

## Conventions

- Hard tabs. Alphabetical ordering for keys, imports and lists unless order is logic-significant.
  Two deliberate exceptions: command parameters are in wire order (above), and the `errors` and TLV
  tables are ordered by their numeric id so they can be diffed against the spec and gaps stay visible.
- Comments are the exception, not the default — see the root `CLAUDE.md` rules. Do not write file
  preambles or restate what the code says.
- Test data uses real randomised UUID v7 values, never `aaaa-0000` placeholders.
- Fixtures that encode the wire are shared so no two files can drift on it: `test/raw-pdus.ts` builds
  the octets a test writes straight to a socket, the PDUs `objToPdu()` refuses to build included. So
  is the peer that answers on its own: `test/dummy-smsc.ts` is the one auto-answering SMSC, because
  two copies drift in what they answer rather than in what a test asserts, and one that quietly stops
  answering `enquire_link` fails the file that copied it for a reason nothing in that file names.
  Reach for it where the peer's answers are not what the test is about; where they are, `smscPeer()`
  in `test/session.test.ts` answers the bind and hands every other PDU to the test to answer, and
  stays there because that is a different peer rather than a second copy of this one. The waiting
  helpers each file carries are copies, tolerated because a wrong one fails that file's own tests and
  nothing else, and a helper that only names the parameters of one `objToPdu()` call is on that same
  footing — it encodes no wire fact `objToPdu()` does not already own. So is a stub standing in for a
  collaborator the type system already keeps in step: `recordingDeps()` in `messaging-mode.test.ts`,
  `message-class.test.ts` and `unsendable.test.ts` is one `SendSmsDeps.send` that answers nothing,
  and a field added to that type fails to compile in every copy at once.
- `message_id` values the library generates are UUID v7.
- A test that needs a dummy peer must `resume()` its sockets. An unread socket never processes the
  peer's FIN, so `server.close()` hangs forever — that is a test bug, not a library one.
- Everything a test opens gets its teardown registered as it is opened, never closed on the test's
  last line: an assertion that throws skips that line, and the listener it leaves behind keeps
  `node --test` alive until CI's ten-minute cap. `test/teardown.ts` covers a session, a server and a
  listener; anything else takes a bare `t.after`. Its close aborts rather than drains, so a test that
  fails holding the send window still ends.
- `t.after` hooks run in registration order, so registering at creation tears the outermost resource
  down first. A teardown that waits on a listener must destroy that listener's own connections before
  it waits, or be registered after the hook that does — `net.Server.close()` does not call back until
  every connection on it is gone.
- `assert.equal` from `node:assert/strict` narrows its first argument, so a following `?.` on the
  same value is flagged as unnecessary. Assert once with `assert.ok(x)` and use plain access after.

## Documentation

Each file answers one question, and a fact belongs to the file whose question it answers:

- **README.md — what you can rely on, and where this is heading.** Observable behaviour, for
  someone using the package, plus the goals and the audience. It carries a reason only where the
  reason changes how you would call the thing.
- **MIGRATION.md — what a 0.4.0 consumer has to change.** Renamed and removed surface, and the
  behaviour that changed on the wire.
- **AGENTS.md — what may not change, and why.** Hard rules, architecture, conventions, and an index
  of the decisions. It does not restate behaviour or goals README states.
- **docs/decisions.md — what was settled, and against what.** The decisions the goals do not
  already settle, each with the constraint that settled it and the alternative rejected.
- **todo.md** is a working file that sets its own rules; nothing here governs it.

A sentence living in two of them is a defect: delete the copy in the file whose question it does not
answer. The toolchain commands are the one deliberate exception — README's copy serves a contributor
who never opens this file, and this file's copy carries the constraint that nothing runs on the host.

**Write a decision down only when it cannot be put better as a goal.** A goal decides every case that
follows from it; a decision record decides one. So reach for the goal list first — sharpen a goal,
add one, or move one up the order — and write a decision only for what is left over: a choice a
competent change would otherwise re-open, that no goal implies. Give the claim, the constraint that
settled it and the alternative rejected, and nothing the code or README already says. Where a
compiler or a test already forbids the other way, it is not a decision, it is a test name. It goes in
`docs/decisions.md` with its title indexed below. Delete one once it no longer constrains anything;
this is not a changelog.

## Decisions

The decisions themselves live in [docs/decisions.md](docs/decisions.md). Their titles are indexed
here, so a reader sees that a decision exists without carrying its reasoning; the reasoning is in
the file.

### [The public surface](docs/decisions.md#the-public-surface)

- `Session` is publicly constructible, which is what makes `SessionOptions` and `ReconnectOptions`
  public too.
- `acceptsOptionalParams()` and `bindAllows()` are predicates, not chokepoints.
- `session.sock` is a getter over `PduTransport`.
- Both emitters re-declare their listener methods to accept a promise.
- `PduRefusedError` is exported, and `sessionError` names it in the event's type.
- `bitCount()`, `encodeMessage()` and `splitMessage()` keep their total signatures, because
  `EncodingName` is what keeps an alphabet with no codec away from them.
- A segment the SMSC took and named no id for is `undefined` in `smsIds`, not an empty string.

### [The wire](docs/decisions.md#the-wire)

- The declared interface version is an option on both `client()` and `server()`, and is not the
  optional-parameter threshold.
- A peer that declared no version is pre-3.4, and `undefined` means no bind yet.
- `esm_class` decides what a `deliver_sm` is, and the body is read only when it names nothing.
- A body is read from `message_payload` where `short_message` carries none, and `short_message` wins
  where a peer filled both.
- A segment's concatenation is read from its UDH, or from the `sar_*` TLVs where it declares none,
  and each spelling groups in a reference space of its own.
- `sendSms()` takes the messaging mode by name, and it is the only part of `esm_class` a caller
  writes.
- An inbound `data_sm` stands in for whichever of `submit_sm` and `deliver_sm` its direction makes
  it, and none goes out.
- A receipt's body is read as octets, and its own `data_coding` never says how.
- A message class is read where GSM 03.38 puts it, `flash` is class 0 alone, and a flash message
  with no alphabet to carry it is refused.
- A report is final unless its `esm_class` or its state says otherwise, and only `ENROUTE` and
  `SCHEDULED` say otherwise.
- A `stat:` an operator spells outside Appendix B is read as the state it names, and the two
  researched ones are `FAILED` and CM.com's `DELIVERD`.
- A transient state goes out as an intermediate delivery notification (0x20), every other state as a
  delivery receipt (0x04).
- A refused PDU is answered from its header, and any 32-bit `sequence_number` is echoed as it
  arrived.
- The optional parameters run to `command_length` exactly, and the only slack tolerated is one NULL
  octet where a peer padded `short_message`.
- `smsIdFormat` names a notation per place, and normalisation never reaches inside a `<base>-<n>`
  id.
- A concatenated segment is budgeted at 134 octets, which is 153 septets where the SMSC packs them
  and 134 octets of anything it does not.
- An alphabet the caller named has to carry the message, and a time the format cannot express is
  refused, both before a segment goes out.
- A string body is written in the alphabet its own `data_coding` names, and one that alphabet cannot
  carry is refused by the codec — `message_payload` on the same terms as `short_message`.
- A GSM 03.38 message declares `data_coding` 0x00, and an inbound 0x01 is still read as GSM.

### [The session's life](docs/decisions.md#the-sessions-life)

- A close arriving after our own `unbind` is a clean unbind, not an error.
- `close` means the session is over, and a drop the loop will retry is `disconnected`.
- An answer belongs to the link the message arrived on; a receipt does not.
- `reconnect` takes `{ minDelay, maxDelay }` to retune and `false` to turn off
- Coming up is not proof a link works, so only one that outlasted `maxDelay` resets the backoff.
- `reconnect: { fromStart: true }` puts the first connect and bind through that same loop, and
  `client()` then resolves only once it is bound.
- A stream this library cannot frame is a dead link; one PDU it cannot parse is not.
- A deliberate shutdown drains; an unusable link and an abort do not.
- Every segment of a concatenated message is answered as it arrives, so `sendResp()` on one is the
  application's own signal rather than the peer's answer.
- `server()` composes the application's `onRequest` after its own bind handling, and offers it every
  request that handling did not answer.
- The drain waits on the messages the application holds, and `sendResp()` is what says it is done
  with one.
- A reconnect keeps the delivery-receipt merges; everything else the link held is dropped.
- A message id base is merged at most once.
- A send that never reached the socket waits for the next link; one that did is counted, not resent.
- A send queued for a send-window slot is bounded by the caller's `signal`, and by nothing else.
- The gate decides whether a link can carry a request, and a bind is what makes it one.

### [Internals and tests](docs/decisions.md#internals-and-tests)

- A listener that rejects is routed by Node's `captureRejections`, not by hand-dispatching.
- The four-line abort dance is copied across `LinkGate`, `IdleWaiters`, `PendingRequests` and
  `SendWindow` rather than extracted.
- `SmppLog` is a five-method contract this library declares, not a dependency.
- The TLS tests build their own self-signed certificate in DER
- `src/` stays flat until a module has to move for another reason.
- `test/` stays flat too, and a file there is named for the question it answers rather than for the
  module it covers.
- CI tests on Linux only; `src/` keeps off what is known to break on macOS or Windows.
