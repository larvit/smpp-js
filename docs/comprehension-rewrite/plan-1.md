# Plan 1: the application developer's mental model as the source tree

Lens: an application developer thinks in six verbs: *connect* (client), *listen* (server), *send*,
*receive*, *get a report*, *shut down*, plus *read PDUs* when they go low-level. Every directory is
one of those verbs, in the README's order, and every boundary between them is a seam a developer
already knows exists.

## 1. Principles

1. **The README's table of contents is the directory listing.** `Send an SMS` → `sending/`,
   `Delivery reports` → `receipts/`, `Receive SMS` → `receiving/`, `Run an SMPP server` → `server/`,
   `Client options`/reconnect → `client/`, `Session` → `session/`, `PDUs and the low-level API` →
   `wire/`, `Encoding`/long messages → `text/`. Answers: Navigation stuck at 6 in every round, while
   C, the one draft with grouped folders, reached Locality 6 on every seat.
2. **One socket, one `Session`, one life.** A `Session` goes `open → bound → closing → closed` and
   never backwards. Reconnect is a separate `ClientSession` above it, whose state is a discriminated
   union holding a `Session` only while one is up. Answers lesson 3: `LinkLife`'s phase plus
   `stopped`, seven predicates, call-order-dependent `linkLost`/`end`/`dropSocket`, and
   `ReconnectLoop`'s duplicate stopped flag. F showed that the split removes the unit; this plan keeps
   F's split and fixes what F left, below.
3. **Every invariant has one owner, and that owner's file states it.** "Every inbound request gets
   exactly one answer" → `session/owed-answer.ts`. "Nothing held without a bound" →
   `limits/bounded-store.ts`. "A send that never reached a socket may go out on the next one" →
   `client/next-link.ts`. Answers round three's "enforced jointly by `IncomingRequests` and
   `sms.ts`", and D's "answered in three places".
4. **Lower areas never call up; they declare the port they need.** `receiving/`, `receipts/` and
   `sending/` export functions and classes that take a narrow port type *declared in their own
   file* (`AnswerPort`, `SendPort`, `report(err)`). `Session` implements the ports. Answers finding 4:
   `IncomingRequests`/`HeldMessages` calling `emit`, `sendReturn`, `close` and `listenerCount` on
   `Session`.
5. **A store enforces its own bound.** `BoundedStore` evicts, expires and weighs by itself, never
   evicts the entry being admitted, keeps reads pure, and reports every removal through one
   `onRemoved(key, value, reason)`. Answers round three's most-cited unit: `ExpiringGroups` plus
   `Reassembler.trim`.
6. **A state change's effects sit inside the transition that causes them.** No reducer that returns
   effects, and no callbacks wired from another file. Answers E, whose state machine scored no better
   because each transition's meaning was split over five callbacks.
7. **Every SMPP term is glossed once, and every spec citation carries its half-line summary.**
   `SMPP 3.4 5.2.12 (esm_class: message type and mode bits)`, never a bare `5.2.12`. The README gets
   a glossary table (ESME, SMSC/MC, PDU, bind, esm_class, data_coding, UDH, sar_*, TLV, receipt,
   segment). Answers lesson: juniors score Self-sufficiency 5 because of bare citations and
   `data_coding` bit masks.
8. **Every default in one file.** `src/defaults.ts`, grouped by the verb that uses them. Answers
   "defaults spread over several files".
9. **Hard parts are marked by one convention.** A hard part opens with an `Invariant:` paragraph at
   the code it guards, which the comment rules permit, and AGENTS.md gets a "Where it is hard" list
   naming the file of each. The panel's "7" asks for hard parts that are few, localized and marked.

## 2. Layout

Dependencies point downward in this order: `wire` ← `text` ← `limits` ← {`sending`, `receiving`,
`receipts`} ← `session` ← {`client`, `server`} ← `index.ts`. Root files are importable by all.
The only ways up are ports: types declared low, implemented by `session/`.

```
src/                         fan-out 13: 4 files, 9 areas
  index.ts                   Public surface, named exports only. Grouped by the README's sections.
  defaults.ts                Every default value, grouped by client/server/session/stores. No logic.
  log.ts                     SmppLog, silentLog, guardedLog.
  result.ts                  Result<T>, VoidResult, errorFrom(), namedValue(), UnansweredError.

  wire/                      "PDUs and the low-level API". Fan-out 6 + tables/
    pdu.ts                   pduToObj/objToPdu/pduReturn/isCommand/isResp. Stateless, total.
    framer.ts                PduFramer: byte stream → complete PDUs. State: the partial buffer.
    refusal.ts               PduRefusedError, PduHeader, the status SMPP names for each refusal.
    retained-pdu.ts          detach() and retainedOctets(): what holding a PDU costs.
    smpp-time.ts             smppDate/smppTime: the 16-char time format, absolute and relative.
    tables/                  The spec, as data. Fan-out 7. Knows nothing above it but result.ts.
      commands.ts            33 commands, ids, params in WIRE ORDER (invariant stated at the top).
      constants.ts           consts, constsById, interface versions.
      alphabets.ts           GSM 03.38 (named gsm7 internally; 'ASCII' only as the public name), LATIN1, UCS2 codecs; detection.
      data-coding.ts         data_coding → alphabet and message class; one row per coding group with its meaning in words.
      errors.ts              ESME_* by numeric id.
      tlvs.ts                TLV table by numeric id; typed read/write of a TLV stream.
      types.ts               Wire types int8…cstring, arrays.
      index.ts               defs, the grouped tables.

  text/                      "Encoding" and "Long messages". Fan-out 3. Pure functions.
    message-text.ts          encode/decode/bitCount/unencodable; where a PDU's body is (short_message vs message_payload).
    splitting.ts             splitMessage and segment budgets (153 GSM unpacked / 134 / 67); the "GSM is sent unpacked" note lives here.
    concatenation.ts         Both spellings, both directions: UDH build/parse, sar_* read, concatOf(), ConcatReference counter.

  limits/                    What is bounded, and waiting on it. Fan-out 3.
    bounded-store.ts         BoundedStore<V>: count cap, weight cap, expiry, one sweep timer, onRemoved(key, v, reason). Invariant: admit never evicts its own key; get() never mutates.
    send-window.ts           SendWindow: the maxOutstanding semaphore; idle(timeout) for the drain.
    idle-waiters.ts          Waiting for a count to reach zero within a budget.

  sending/                   "Send an SMS". Fan-out 2.
    compose-submit.ts        submit_sm params from SendSmsOptions: TON, messaging mode, flash, times, the alphabet check. Pure.
    sms-sender.ts            SmsSender: split, send every segment together through a SendPort, collect ids, tell the merger. State: ConcatReference, ReceiptMerger.

  receipts/                  "Delivery reports". Fan-out 5.
    receipt-states.ts        message_state ↔ stat: codes, FAILED/DELIVERD aliases, which states are transient. Invariant: only ENROUTE/SCHEDULED are not final.
    read-receipt.ts          dlrFromPdu(), parseReceipt(): esm_class, then TLV, then body.
    write-receipt.ts         The deliver_sm a sendDlr() sends: text, TLVs, esm_class 0x04 vs 0x20. Pure.
    receipt-merger.ts        ReceiptMerger: per-segment receipts into one MessageDlr. State: open groups, spent bases (BoundedStore x2). `close` renamed `spend`.
    message-ids.ts           uuidv7(), <base>-<n>, smsIdFormat normalisation, which response carries an id.

  receiving/                 "Receive SMS" and "Receiving in depth". Fan-out 4.
    receive-message.ts       The one path an inbound message takes: bound check → concat? → reassemble → answer segment → hand whole message to handlers. Takes AnswerPort per request.
    reassembler.ts           Reassembler: incomplete groups in a BoundedStore; lost groups reported once.
    running-handlers.ts      RunningHandlers: onSms calls in flight. State: count, weight, deadline per call. Invariant: return releases, throw refuses with the retry status, no handler refuses at once. Its SendPort lets a running handler's sendDlr pass the drain.
    sms.ts                   The Sms handle: fields decoded once; sendResp → the message's OwedAnswers; sendDlr → write-receipt via SendPort.

  session/                   "Session". One socket's life. Fan-out 8.
    session.ts               Session (public): state 'open'|'bound'|'closing'|'closed' in one field; bound(), send, sendSms, sendReturn, close, unbind; emits. Each transition method carries its own effects.
    session-options.ts       SessionOptions type and its checks.
    transport.ts             One socket + framer + write(). No attach(): a socket never changes.
    heartbeat.ts             enquire_link on quiet, idle timeout. State: two timers.
    requests.ts              Outgoing: seqNr, pending map, response timeout, window slot, abort, UnansweredError. Merges pending-requests + outgoing-requests minus link logic.
    dispatch.ts              An inbound PDU's route: response → requests; request → onRequest hook → bind direction → enquire_link/unbind/re-bind/unknown/message/receipt.
    owed-answer.ts           OwedAnswer: created for every inbound request at dispatch; the only writer of a response. State: owed|answered|lost. Implements AnswerPort.
    bind-direction.ts        What each bind type carries per link end; data_sm stands in for submit_sm or deliver_sm; checkedBind().
    shutdown.ts              The drain: handlers first, then requests, one deadline, the err naming what was lost.

  client/                    "Client options" and reconnect. Fan-out 5.
    client.ts                client(), ClientSession (public): state {kind:'connecting'} | {kind:'up', session} | {kind:'down', attempt} | {kind:'closed'}. Forwards events of the current Session; owns SmsSender so merges survive a reconnect.
    client-options.ts        ClientOptions and their checks (connectTimeout, reconnect spelling, fromStart).
    connect.ts               Open a socket: TCP or TLS, connectTimeout over both.
    bind.ts                  bind_* params, the bind response → session.bound().
    reconnect.ts             Backoff as a pure function (delay, upSince) → next delay, and the retry timer. No stopped flag: the ClientSession's 'closed' state is the stop.
    next-link.ts             Sends waiting for a bound Session, one budget each; a send that never reached a socket retries here. Invariant: nothing that reached a socket is resent.

  server/                    "Run an SMPP server" and "Server in depth". Fan-out 3.
    server.ts                server(), SmppServer: listener, sessions set, close() = stop listening then drain each.
    server-options.ts        ServerOptions and their checks.
    accept-bind.ts           Pre-bind requests, authenticate, bind_resp with sc_interface_version, Session.bound().
```

Deepest level is 3 (`src/wire/tables/`). Maximum fan-out 13 at `src/`, otherwise ≤ 8.

## 3. Public API changes

Three changes; everything else in the README keeps its spelling, including `client()` resolving
`{ err, session }`, so every send and receipt example survives untouched.

1. **Inbound messages reach an `onSms` handler option instead of an `sms` event.**
   - Old: `session.on('sms', async sms => { await sms.sendResp(); })`, and a server's
     `smpp.on('session', s => s.on('sms', …))`.
   - New: `client({ onSms })`, `server({ onSms })`, `new Session({ onSms })`, typed
     `(sms: Sms) => Promise<void> | void`. `sms.sendResp()` stays the only way to answer, with the same
     options. Returning releases the message, answering `ESME_ROK` first if `sendResp()` was not called.
     Throwing or rejecting refuses it with the retry status (`ESME_RTHROTTLED` or `ESME_RX_T_APPN`)
     unless it is already answered, and reports it on `sessionError`. With no `onSms`, every message is
     refused at once with that retry status and one `warn` is logged. `sendDlr()` before the answer
     returns `err`. `sms.answeredOnArrival` stays.
   - Removes: the held-message timing contract (lesson 1): listener counts, the `setImmediate` turn,
     `captureRejections` routed through a `WeakMap`, and "answered" living in three places, because
     `answeredOnArrival` becomes a getter over the OwedAnswers.
   - Serves goal 2 (a crash before the answer leaves the peer to resend, unlike C) and goal 5. The
     no-handler refusal is a judgement call that goes in docs/decisions.md, resting on goal 2's "work
     the peer has no reason to send again is not dropped".
   - Migration is one line per listener: the handler body is unchanged.
2. **A `Session` is one socket; reconnect is `ClientSession`, which `client()` returns.**
   - Old: `Session` with a `reconnect: { connect, onConnected }` option, `disconnected` and
     `reconnected` events, and `sock` swapped under it.
   - New: `Session` has no `reconnect` option, no `disconnected`/`reconnected`, and a fixed `sock`.
     `client()` still resolves `{ err, session }`, where `session` is a `ClientSession` with today's
     client methods (`sendSms`, `send`, `unbind`, `close`, `boundAs`, `peerInterfaceVersion`,
     `acceptsOptionalParams()`, `bindAllows()`) and events (`close`, `disconnected`, `reconnected`,
     `dlr`, `messageDlr`, `sessionError`, plus `data`/`incomingPdu`/`incomingPduObj` forwarded from
     the current link). `session.sock` and `session.sendReturn()` move to `session.link`, the current
     `Session` or `undefined` while down, because both belong to one socket. A hand-wired ESME that
     wants reconnect builds a new `Session` per socket.
   - Removes: `LinkLife` and its predicates, the call-order hazard, `ReconnectLoop`'s duplicate stop,
     and client.ts's `bindOn` depending on another file's ordering (lesson 3).
   - Serves goal 8 (a smaller surface, a stated scope for `Session`) and goal 4 (one stop state, so no
     path rebinds after close).
3. **`linkEnd` becomes a readonly constructor option on `Session`** (old: a writable field
   `session.linkEnd = 'smsc'`). A field mutable after dispatch starts is a hidden state a reader has
   to chase through `bind-direction.ts`. Serves goal 4, since the bind direction decides what is
   refused.

Kept deliberately: `encoding: 'ASCII'` as the public name of GSM 03.38 (inherited from 0.4.0,
MIGRATION.md relies on it). Internally the alphabet is `gsm7` everywhere, and `alphabets.ts` glosses
the public name once. `sessionError`'s kinds stay told apart by type and message: no panel cited them.

## 4. Where each thing goes

| Now | New home |
| --- | --- |
| client.ts | client/client.ts (client(), fromStart), client/connect.ts (openSocket, connectTimeout), client/bind.ts |
| server.ts | server/server.ts, server/accept-bind.ts (authenticate, pre-bind, bind_resp) |
| session.ts | session/session.ts (state, API, emit guard); drain → session/shutdown.ts; dispatch/refuse → session/dispatch.ts |
| sms.ts | receiving/sms.ts (handle, sendResp); receipt building → receipts/write-receipt.ts |
| concat.ts, udh.ts | text/concatenation.ts |
| dlr.ts | receipts/read-receipt.ts, receipts/receipt-states.ts |
| dlr-merger.ts | receipts/receipt-merger.ts (`close` → `spend`) |
| error-from.ts, unanswered-error.ts, result.ts | result.ts |
| expiring-groups.ts | limits/bounded-store.ts (enforcing its own caps) |
| held-messages.ts | receiving/running-handlers.ts |
| idle-waiters.ts, send-window.ts | limits/ |
| incoming-requests.ts | session/dispatch.ts (routing, bind direction, unbind, unknown) + receiving/receive-message.ts (message path, store bound) |
| link-life.ts | deleted: the state goes to session.ts's one field; waiting for a link goes to client/next-link.ts |
| link-timers.ts | session/heartbeat.ts |
| log.ts, result.ts | root |
| message.ts | text/message-text.ts, text/splitting.ts; smppDate/smppTime → wire/smpp-time.ts |
| message-body.ts | text/message-text.ts |
| outgoing-requests.ts, pending-requests.ts | session/requests.ts; the next-link retry → client/next-link.ts |
| pdu.ts, pdu-framer.ts, pdu-refusal.ts, retained-pdu.ts | wire/ |
| pdu-transport.ts | session/transport.ts, without attach() |
| reassembly.ts | receiving/reassembler.ts; decodeSegments → text/message-text.ts |
| reconnect-loop.ts | client/reconnect.ts |
| send-sms.ts | sending/compose-submit.ts + sending/sms-sender.ts |
| session-options.ts | defaults → defaults.ts; checks → each area's *-options.ts; bindCarries/standsInFor/checkedBind → session/bind-direction.ts |
| sms-id.ts, uuid.ts | receipts/message-ids.ts |
| defs/* | wire/tables/*; encodings.ts split into alphabets.ts and data-coding.ts |

Named-hard responsibilities:

| Responsibility | Home and owner |
| --- | --- |
| Held messages and answering | session/owed-answer.ts (one answer per request); receiving/running-handlers.ts (the handler's life) |
| Lifecycle and reconnect | session/session.ts (one-way state); client/client.ts (union state), client/reconnect.ts (backoff) |
| The drain | session/shutdown.ts, one function; a running handler's sends admitted through its own SendPort |
| Outgoing requests and retry | session/requests.ts (one link, no retry); client/next-link.ts (the only retry) |
| Reassembly and ExpiringGroups | receiving/reassembler.ts over limits/bounded-store.ts |
| Receipts and merging | receipts/ (read, states, write, merger); merger owned by SmsSender, which ClientSession holds across links |
| The codec | wire/pdu.ts over wire/tables/ |
| Encodings | wire/tables/alphabets.ts, wire/tables/data-coding.ts; text/ above them |
| Defaults | src/defaults.ts |
| Domain knowledge and glossary | README glossary table; summarised citations; the defect table and "GSM is sent unpacked" stay in AGENTS.md, with a pointer line in splitting.ts |

## 5. The hard parts that stay hard

Each is marked with an `Invariant:` paragraph in its file and listed under "Where it is hard" in
AGENTS.md.

1. **Exactly one answer per inbound request** (session/owed-answer.ts). The hardness is SMPP's: a
   multipart message is answered per segment on arrival, a single one when the application says, a
   refused PDU from its header alone, and never on a link that is gone. Localized, since OwedAnswer
   is the only writer, and a test asserts no other file calls `transport.write` with a response.
2. **The drain's order and budgets** (session/shutdown.ts). Handlers first, because a handler's
   answer can put a receipt on the wire. `shutdownTimeout: 0` still bounds the handler half. One
   function, about 40 lines, with its budget rule in its signature.
3. **Retry only what never reached the socket** (client/next-link.ts). Goal 2's "never re-sent on
   the library's own initiative". The rule is one predicate over the `requests.ts` result
   (`written: false`), and the loop lives only here.
4. **Bounded stores and eviction order** (limits/bounded-store.ts). The reassembly weight rule, 1000
   plus octets plus 300 per TLV, stays in receiving/reassembler.ts as one function beside its
   README-facing constant.
5. **data_coding coding groups** (wire/tables/data-coding.ts). Bit masks are unavoidable. One table
   row per group states in words what the group means and whether it carries a class.
6. **Receipt classification** (receipts/read-receipt.ts). esm_class, then TLV, then text, with
   operator aliases. It is operator folklore, so each alias names the operator in one line.

## 6. Build order

Each chunk keeps the suite green. Tests move to the new API only in chunks 5 and 6, the two
contract changes.

1. **Tables and codec.** Move defs/ to wire/tables/, split encodings, rename gsm7 internally, and
   move pdu, framer, refusal, retained and time into wire/. Add summaries to every citation.
2. **text/ and receipts/.** Pure moves plus `spend`. message-ids absorbs uuid.
3. **limits/.** BoundedStore replaces ExpiringGroups, with its own tests for "admit never evicts
   itself" and "reads are pure". Reassembler, merger and held messages port onto it.
4. **defaults.ts, the *-options.ts files, sending/.** SmsSender with its SendPort.
5. **Contract 1: onSms.** Add owed-answer.ts, receiving/, and session/dispatch.ts. Delete
   held-messages and incoming-requests. Port the `sms` listeners in tests and README, and add the
   decision record for the no-handler refusal.
6. **Contract 2: one-socket Session, ClientSession.** Session gets its one-way state, plus
   transport without attach, requests, heartbeat and shutdown. The client gets client/,
   next-link and reconnect. Delete link-life. Port the reconnect tests to ClientSession, and make
   `linkEnd` an option.
7. **server/** split, index.ts regrouped by README section, the README glossary, AGENTS.md
   architecture, and "Where it is hard".
8. **Run the comprehension panel.** Fix only what it names inside the hard-parts list.

## 7. Predicted panel risks

- **ClientSession forwarding** (client/client.ts). It re-emits the current Session's events and
  answers `boundAs` through the gap. A reader asks "which object do I listen on?" Mitigation: README
  Events table gains one column, `Session` / `ClientSession`. Likely Shape 6 on the senior's seat if
  the forwarding list is long.
- **Two SmsSenders in client mode.** A Session inside a ClientSession has its own unused sender, and
  the ClientSession's merger is fed from the link's `dlr`. Alternative: Session takes an optional
  injected SmsSender. Pick one at chunk 6 and state it in client.ts's invariant.
- **Ports feel like indirection to the junior.** `AnswerPort`/`SendPort` add names. Mitigation: each
  port is 1–3 members and declared in the file that uses it.
- **Root fan-out of 13, and `limits/` is a new abstraction name.** A mid may look for the send window
  under session/. It is cross-referenced from requests.ts's constructor argument only.
- **The no-handler refusal** surprises a transceiver client that never expected MO traffic: its SMSC
  retries forever. That is a goal-2-correct outcome, but a reader may argue it; the decision record
  must carry the argument.
- **The coarse scale.** Removing a unit has moved the hardest unit elsewhere every round. The most
  likely next candidate is `owed-answer.ts` + `receive-message.ts`, which could hold a mean at 6.5
  rather than 7. The mitigation is to keep it the only writer and test that.
