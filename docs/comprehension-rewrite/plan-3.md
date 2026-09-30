# Plan 3: the newcomer's lens

A reader who has never opened the SMPP spec reads `protocol/` and learns the protocol from plain-English
types; a reader who knows it reads `session/` and holds the whole machinery at once. Builds on F (one
socket per `Session`, reconnect above it, `onSms` answered on return) and removes what F's panel still
named: `ExpiringGroups`, "exactly one answer" split over two files, and the junior's missing SMPP.

## 1. Principles

1. **Every octet that packs several facts is translated once, in `protocol/`, into a named plain type.**
   `esm_class`, `data_coding`, `registered_delivery`, the UDH, `sar_*` and `message_state` are read and
   written there and nowhere else; `session/` and `messages/` never see a bit mask. Answers: juniors at
   Self-sufficiency 5 (masks, bare citations), "no glossary".
2. **The vocabulary is code.** `protocol/vocabulary.ts` holds one type per SMPP term (ESME/SMSC,
   bind type, alphabet, message kind, segment, TLV, status), each with a one-line TSDoc definition the
   editor shows on hover. A README glossary did not lift juniors; a definition beside the use does.
3. **A spec citation always carries its sentence.** `SMPP 3.4 §5.2.12 (esm_class): bits 5-2 say whether
   this is a message or a receipt.` A test greps `src/` and fails on a bare `§x.y.z`. Answers: "citations
   with no summary".
4. **A `Session` is one socket, and its life only moves forward.** `open → bound → closing → closed`,
   one field, one transition function, no flag beside it. Reconnect lives above, in `SmppClient`, which
   holds only what outlives a socket. Answers lesson 3 (LinkLife, seven predicates, call-order
   correctness, duplicated stopped flags); F showed it takes the lifecycle off the hardest-unit list.
5. **An answer is a return value, and one function writes it.** Every inbound request resolves to one
   `Reply`; `session.ts` writes it in one place. `onSms` and `onRequest` return replies instead of
   calling a sender. Answers F's "exactly one answer enforced jointly by IncomingRequests and sms.ts",
   and lesson 4's callbacks into `Session`.
6. **A bounded store refuses; it never evicts.** One `BoundedStore` enforces its own count, weight and
   expiry; reads never mutate; the only removal a caller did not ask for is expiry, reported through
   one callback. A full store refuses the newcomer, and the peer retries it (goal 2: nothing the peer
   will not resend is dropped). Answers `ExpiringGroups`/`Reassembler.trim` (4 of 8 F seats).
7. **Every default is one row in one table.** `options.ts`. Answers "defaults spread over several files".
8. **Names say the domain, not the implementation.** GSM 7-bit is `gsm7` everywhere; `DlrMerger.close`
   becomes `spend`; no `ascii`.

## 2. Layout

Areas, in reading order: `protocol/` (what SMPP means), `codec/` (bytes ↔ objects), `messages/`
(whole messages), `session/` (one socket), `client/`, `server/`. Imports point down that list in
reverse: `codec` ← `protocol` ← `messages` ← `session` ← `client`/`server`; `protocol` knows `codec`'s
tables only. Fan-out: root 10 (4 files, 6 dirs); `codec/` 8; `protocol/` 10; `messages/` 8;
`session/` 7; `client/` 3; `server/` 2. No file over ~300 lines except `codec/field-types.ts`.

```
src/
  index.ts            Public surface, named exports only.
  options.ts          `defaults`: every default and internal cap, one row each with its why; the
                      option checks for client(), server() and new Session(). No state.
  result.ts           Result<T>, VoidResult, errorFrom(), namedValue(). No state.
  log.ts              SmppLog, silentLog, guardedLog(). No state.
  codec/              Bytes <-> PduObject. Knows field layout, never meaning.
    commands.ts       The 33 commands, ids, params in wire order (invariant: never sorted).
    tlvs.ts           TLV table by id, typed read/input shapes, read/write a TLV stream (exact to
                      command_length, one NULL pad tolerated).
    statuses.ts       command_status table (ESME_*), by id.
    constants.ts      Raw numeric tables (`consts`), exported as-is; meaning lives in protocol/.
    field-types.ts    int8/16/32, C-Octet and Octet strings, buffers, address arrays; range-checked.
    pdu.ts            pduToObj / objToPdu / pduReturn / isCommand / isResp. Synchronous, total.
    framer.ts         PduFramer: a byte stream cut into PDUs; state: the chunk list.
    refusal.ts        PduRefusedError, framing refusal, the status a refused PDU is answered with.
  protocol/           What the fields mean. Plain types out, SMPP octets in. No state.
    vocabulary.ts     One type per SMPP term with its one-line definition: LinkEnd (ESME/SMSC),
                      BindType, Alphabet, MessageKind, Segment, MessageState, Reply. The glossary.
    alphabets.ts      The gsm7, latin1 and ucs2 codecs; detect(); unencodable(); bitCount().
    data-coding.ts    data_coding as a table of rows {octets, alphabet, messageClass, why}; read
                      and write through the table, never a mask outside it. Flash lives here.
    esm-class.ts      esm_class -> {kind: message|receipt|intermediate, hasUdh, mode} and back.
    segments.ts       How a PDU says it is a segment: the UDH (walked, with its reference) or sar_*,
                      and the reference counter per client (state: one counter).
    receipt.ts        Receipt text and TLVs -> Dlr (stat: spellings, FAILED, DELIVERD, final or
                      not), and a receipt's deliver_sm params for a state.
    message-ids.ts    Id notations (smsIdFormat), <base>-<n> segment ids, which response carries one.
    time.ts           smppTime (absolute/relative) and the receipt's YYMMDDhhmm stamp.
    bind.ts           What a bind direction carries, data_sm's stand-in, the version that allows
                      optional params, checkedBind().
    arrival.ts        One inbound message-carrying PDU -> Arrival: {kind:'message', text, from, to,
                      segment?, wantsReceipt, flash} | {kind:'receipt', dlr}. Body location
                      (short_message vs message_payload) decided here.
  messages/           Whole messages across segments and time.
    split.ts          Text -> segment bodies at the 153-septet / 134-octet budget (invariant: GSM is
                      sent unpacked; see AGENTS.md).
    submit.ts         SendSmsOptions checked, then one submit_sm params object per segment; all
                      refusals before any segment exists.
    bounded-store.ts  BoundedStore<T>: count cap, weight cap, per-entry deadline. add() returns
                      added|full; get() is pure; expiry on its own timer, reported via onExpire.
    reassembly.ts     Reassembler: segment groups in two reference spaces (udh, sar); add returns
                      kept|unplaceable|full|whole. State: one BoundedStore.
    receipt-merge.ts  ReceiptMerge: per-segment Dlrs -> one MessageDlr; a base merged once (spent).
                      State: two BoundedStores (open, spent).
    retained.ts       detach() a PDU off its chunk; retainedOctets() for weights.
  session/            One socket's life. State lives in session.ts, requests-out.ts, handlers.ts.
    session.ts        Session: lifecycle field + transition table, the event surface, admit() for
                      sends, write() for replies — the only writer of responses. ~250 lines.
    requests-out.ts   OutgoingRequests: sequence numbers, pending map, send window, response
                      timeout, abort. One entry point. Reports written-or-not on failure.
    requests-in.ts    replyFor(pdu, context) -> {reply?, after?: 'close'}: bind direction,
                      enquire_link, unbind, receipts, messages, unknown commands. No state, no
                      callbacks into Session.
    handlers.ts       RunningHandlers: onSms calls in flight; count/weight bound; handlerTimeout
                      answers with the retry status; idle() for the drain.
    keepalive.ts      enquire_link on a quiet link, idle timeout. State: two timers.
    transport.ts      Socket -> framed, parsed PDUs; refusals; the socket is fixed for life.
    waiting.ts        waitUntil(predicate, budget, signal) and leftOf(): the abort dance, once.
  client/
    client.ts         SmppClient: current session, cross-link state (ReceiptMerge, segment
                      reference counter), request loop that waits for a bound session and retries
                      only an unwritten request; re-emits session events; close()/unbind().
    connect.ts        openSocket (net/TLS, connectTimeout) and bind(); returns a bound Session.
    backoff.ts        Backoff: next delay, reset after a link outlasts maxDelay. No timers, no stop flag.
  server/
    server.ts         SmppServer, server(): listener, live sessions, close() drains all.
    accept-bind.ts    authenticate, record the bind, bind_resp; before-bind refusals.
```

## 3. Public API changes

Six, all in the minor that ships this (pre-1.0: the minor is the breaking unit). Each lands in
MIGRATION.md; the goal it rests on is recorded in docs/decisions.md.

| # | Old | New | Removes | Goal |
|---|---|---|---|---|
| A1 | `client()` → `{ err, session }`, one `Session` reconnecting under you | `{ err, client }`, an `SmppClient` with `sendSms/send/close/unbind`, events `close/disconnected/reconnected/dlr/messageDlr/sessionError`; `client.session` is the current bound `Session` or `undefined` | Lifecycle as the hardest unit: LinkLife, 7 predicates, re-entrant close, two stopped flags, bindOn's cross-file ordering | 5, 8 |
| A2 | `session.on('sms', sms => sms.sendResp(opts))`; drain waits on unanswered `sms` | `onSms: sms => Reply \| void` option on `client()`, `server()`, `new Session()`; return answers (`ESME_ROK`, or `{ smsId }`, or `{ status }`); throw/reject answers the retry status and reports on `sessionError`; no `onSms` answers the retry status; `sendResp()` removed | Held-message timing contract (six exits, setImmediate, listener counts, WeakMap) and "answered in three places" | 2, 5 |
| A3 | `await sms.sendResp(); await sms.sendDlr()` in the listener | `onSms` may return `{ dlr: MessageState }`: the receipt goes out right after the answer; `sms.sendDlr()` stays for later reports and returns `err` before the answer is written | The "sendDlr let past the drain straight after sendResp" rule; a receipt can no longer precede its answer, and awaiting one inside the handler cannot deadlock | 2 |
| A4 | `onRequest: (s, pdu) => boolean`, answering via `session.sendReturn()` | `onRequest: (s, pdu) => Reply \| undefined`; `undefined` = built-in handling; `sendReturn()` removed from `Session` (`pduReturn()` stays in the codec) | The second answering path; makes "one answer per request" a type | 2, 7 |
| A5 | `new Session({ reconnect, ... })`, mutable `session.linkEnd` | no `reconnect`; `linkEnd` option, readonly; `disconnected`/`reconnected`/`messageDlr` only on `SmppClient` | Reconnect state inside the one-socket unit | 8 |
| A6 | `encoding: 'ASCII'` | `encoding: 'GSM7'`; `'ASCII'` refused at option check with "use 'GSM7'" | A junior reading "ASCII" for GSM 03.38 | 1 (a wrong name invites wrong data), 8 |

Unchanged on purpose: the codec exports, `sendSms()` options and result, `Dlr`/`MessageDlr`, `server()`
options, `sessionError`/`serverError`, `PduRefusedError`. Behaviour change without a signature change:
the reassembly and receipt-merge stores refuse at their bound instead of evicting the oldest (segment:
`ESME_RTHROTTLED`/`ESME_RX_T_APPN`; merge: that send reports through `dlr` alone). Recorded as a
decision on goal 2, which it serves better than eviction did (an evicted group is answered traffic lost).
A6 is the cheapest to drop if the board wants fewer breaks; the internal rename happens either way.

## 4. Where each thing goes

| Now | New home |
|---|---|
| index.ts | index.ts |
| client.ts | client/connect.ts (socket, TLS, timeout, bind), client/client.ts (fromStart, abort) |
| server.ts | server/server.ts, server/accept-bind.ts |
| session.ts | session/session.ts (lifecycle, events, write), client/client.ts (reconnect parts) |
| link-life.ts | deleted: lifecycle field in session/session.ts; "wait for a link" in client/client.ts |
| reconnect-loop.ts | client/backoff.ts (delay math) + client/client.ts (the one timer, stop = state) |
| link-timers.ts | session/keepalive.ts |
| pdu-transport.ts | session/transport.ts (no attach(): one socket) |
| outgoing-requests.ts, pending-requests.ts, send-window.ts, unanswered-error.ts | session/requests-out.ts (one entry point; UnansweredError kept, exported type unchanged) |
| incoming-requests.ts | session/requests-in.ts (returns replies) |
| held-messages.ts | deleted: session/handlers.ts counts running handlers |
| idle-waiters.ts | session/waiting.ts |
| sms.ts | session/handlers.ts builds the Sms; its fields come from protocol/arrival.ts; sendDlr params from protocol/receipt.ts |
| expiring-groups.ts | messages/bounded-store.ts |
| reassembly.ts | messages/reassembly.ts |
| dlr-merger.ts | messages/receipt-merge.ts (close → spend) |
| dlr.ts | protocol/receipt.ts |
| concat.ts, udh.ts | protocol/segments.ts |
| message-body.ts | protocol/arrival.ts |
| message.ts | messages/split.ts (split, budgets), protocol/alphabets.ts (encode/decode/bitCount), protocol/time.ts |
| send-sms.ts | messages/submit.ts |
| sms-id.ts | protocol/message-ids.ts |
| session-options.ts | options.ts (defaults, checks), protocol/bind.ts (directions, stand-in), session/session.ts (events type) |
| retained-pdu.ts | messages/retained.ts |
| pdu.ts, pdu-framer.ts, pdu-refusal.ts | codec/pdu.ts, codec/framer.ts, codec/refusal.ts |
| defs/commands, tlvs, errors, types, constants | codec/commands, tlvs, statuses, field-types, constants |
| defs/encodings.ts | protocol/alphabets.ts + protocol/data-coding.ts |
| defs/index.ts | deleted; `defs` assembled in index.ts |
| error-from.ts, result.ts | result.ts |
| log.ts, uuid.ts | log.ts; uuid.ts → protocol/message-ids.ts |

| Hard responsibility | Home |
|---|---|
| Held messages and answering | session/requests-in.ts decides the reply; session/handlers.ts runs onSms and turns its outcome into a Reply; session/session.ts write() is the one writer |
| Lifecycle | session/session.ts: 4 states, forward only, `close` emitted on entering `closed` |
| Reconnect | client/client.ts (loop, current session), client/backoff.ts (delays) |
| The drain | session/session.ts `close()`: state → closing, `handlers.idle(budget)`, then `requests.idle(rest)`, then closed |
| Outgoing requests and retry | session/requests-out.ts (one link, no retry); client/client.ts (retry on the next link only when unwritten) |
| Reassembly, store | messages/reassembly.ts over messages/bounded-store.ts |
| Receipts and merging | protocol/receipt.ts (reading/writing), messages/receipt-merge.ts (merging), client/client.ts (owns the merge across links) |
| Codec | codec/ |
| Encodings | protocol/alphabets.ts, protocol/data-coding.ts |
| Defaults | options.ts |
| Domain knowledge, glossary | protocol/vocabulary.ts and the rest of protocol/ |

## 5. The hard parts that stay hard

Each is marked by one invariant paragraph at the top of the function it guards (the one comment
exception AGENTS allows), and named in AGENTS.md's architecture list as "hard".

1. **Multipart is answered on arrival, a whole message on return** (decision: a relaying SMSC waits per
   segment). One function, `requests-in.ts replyFor()`, holds both branches; `Sms.answeredOnArrival`
   stays; a Reply refusing an arrival-answered message goes to `sessionError`.
2. **Segment grouping**: two reference spaces, inconsistent totals, the refusal status per spelling.
   `messages/reassembly.ts` only; the store underneath is dumb.
3. **The drain's two budgets** (handlers ignore `shutdownTimeout: 0`, requests do not).
   `session.ts close()`, one function, both budgets computed in one place from `options.ts`.
4. **Retry only what never reached the socket** (goal 2). `client.ts request()`, one loop, reading only
   `result.written`; no link state consulted mid-await because the session it used is fixed.
5. **data_coding**: coding groups, class bits, 0x01 read as GSM. Becomes a readable table in
   `protocol/data-coding.ts`, with a test that the table equals today's function on all 256 octets.
6. **Codec strictness**: TLV stream exact to `command_length`, one NULL pad, 32-bit seqNr echo.
   `codec/pdu.ts` and `codec/tlvs.ts`.
7. **`fromStart` + abort**: `client/client.ts client()` only; the loop's stop is the client's state
   `closed`, so no ordering promise crosses files.

## 6. Build order

Each chunk leaves the suite green and ships through /larv-review.

1. **Moves only**: `defs/` → `codec/`, `options.ts` with one defaults table, `result.ts` absorbs
   error-from. No behaviour change.
2. **protocol/**: vocabulary, data-coding table (256-octet equivalence test), esm-class, segments,
   receipt, message-ids, time, bind, arrival; internal gsm7 rename; citation test.
3. **messages/**: bounded-store, reassembly and receipt-merge on it (refuse-not-evict, decision
   recorded, README bound text updated), split, submit.
4. **session/** under the new contract: one-socket Session, requests-out, requests-in replies,
   handlers, onSms/Reply/`dlr` in Reply, onRequest returning Reply (A2–A5). server/ ported. Tests
   ported by the F translation table; the held-message tests become handler tests.
5. **client/**: SmppClient, connect, backoff; reconnect and `fromStart` tests re-pointed (A1).
6. **A6**, README/MIGRATION/CHANGELOG/decisions/AGENTS architecture; README examples executed;
   interop suite; benchmarks against goal 6's floors.
7. **Four-seat panel run**; its findings become the next chunk.

## 7. Predicted panel risks

- **Two send surfaces.** `SmppClient.sendSms()` and `Session.sendSms()` look alike; a reader asks
  which to call. Mitigation: the Session's is the one-link primitive, documented as such; still likely
  a Navigation point.
- **`Reply` carrying `dlr`** is a second way to send a receipt beside `sms.sendDlr()`. Different
  results (with the answer vs later), but a strict reader may call it two spellings.
- **Refuse-not-evict**: a peer that abandons many groups blocks new multipart for `reassemblyTimeout`.
  A senior may call that an operator-facing regression (goal 4) and score Shape down.
- **protocol/ vs requests-in.ts**: "is it a receipt" (arrival.ts) and "what do we answer"
  (requests-in.ts) are split by design; a junior may look for both in one place.
- **codec/field-types.ts** stays ~650 dense lines; it was never the named unit, but a junior reading
  it cold still scores Self-sufficiency down unless its citations carry their sentences too.
- **Test suite size**: porting ~all session tests is the real cost; a half-ported suite hides
  regressions that a panel will not see but goal 1 will.
- **The coarse scale**: even if every named unit is fixed, a mean of 7.0 needs all four seats to move,
  and the hardest-unit list has moved every round; expect a new one (likely requests-in.ts or
  SmppClient's request loop) at 6.
