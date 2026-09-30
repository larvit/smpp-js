# Plan 2: state ownership first

Every piece of mutable state has one owner. The owner is the only writer, states its invariant in one
paragraph above the class, and enforces it in the same file. Other files read state through the
owner's methods, or learn about it from a result the owner returns. Nothing reaches back up.

## 1. Principles

1. **One object per socket, never reused.** A `Link` is born with a socket and dies with it. Its
   phase only moves forward: `binding → bound → gone`, or `binding → gone`. There is no `attach()`, no
   `stopped` flag and no initial state that breaks its own rule. This answers lessons 3 and round 3:
   LinkLife's 4 phases plus `stopped`, the initial `'up'`, and `linkLost`/`dropSocket`/`comeBackUp`,
   whose correctness depended on call order. F showed that a one-socket unit removes the lifecycle as
   the hardest spot. This plan keeps that idea behind the **current** public `Session`, so the public
   rename F needed is avoided.
2. **Two state fields for the session's life, one per owner, and neither derives from the other.**
   `Session.life: 'open' | 'closing' | 'ended'` belongs to `Session`. `Link.phase` belongs to the
   `Link`. "Can send now" is `life === 'open' && link?.phase === 'bound'`, written once in
   `Session.boundLink()`. The seven predicates of lesson 3 collapse to that one method.
3. **Stoppedness has one writer.** `Session` holds an `AbortController` called `lifetime` and aborts
   it in the same statement that leaves `'open'`. The reconnect loop, the waits for a link and the
   drain only read `lifetime.signal`. This removes ReconnectLoop's duplicate stopped flag (lesson 3)
   and client.ts's "close() must reach stop() before its first await" comment.
4. **A transition finishes before anyone hears about it.** Each transition method writes every field
   first and emits last. A listener that calls `close()` from `disconnected` or `close` finds
   `life === 'ended'` and gets `{}` back. This answers lesson 3's synchronous re-entry.
5. **The inbound answer has one owner.** `link/answers.ts` is the only code that writes a response
   PDU, and it writes at most one per inbound sequence number. `sendReturn()`, bind handling, refusals,
   segments answered on arrival and the value an `onSms` handler returns all go through it. This
   answers round 3's "exactly one answer, enforced jointly by IncomingRequests and sms.ts", and D's
   "answered in three places".
6. **Receiving is a handler, answered on return** (C/D/E/F: the held-message timing contract capped
   every seat). The handler's promise is the hold. There is no `setImmediate`, no listener count, and
   no WeakMap back from a `captureRejections` payload.
7. **A bounded store enforces its own bounds.** `BoundedStore` checks the count, the weight and the
   deadline itself. Reads never mutate. Only `admit()`, `grow()` and its own timer drop entries, and
   every drop goes to one `onDrop(value, reason)` given at construction. It never drops the entry the
   caller is writing: it refuses that write instead. This answers round 3's ExpiringGroups finding,
   named by 4 of 8 seats.
8. **Each spec citation says what it cites, and each bit mask has a name.** `wire/fields.ts` names
   every `esm_class`, `data_coding` and `registered_delivery` field, with one line each. Every
   `SMPP 3.4 x.y.z` cite carries a clause saying what that section requires. The terms are defined in
   `docs/glossary.md`. This answers the juniors' Self-sufficiency 5, whose cost was citations with no
   summary and bare masks rather than a missing glossary.
9. **Defaults live in one table.** `src/defaults.ts` holds every default and every internal cap, with
   one line of why each (lesson 4).

## 2. Layout

Imports point one way: `wire ← text ← receipts ← link ← session ← client, server`. `bounded-store`,
`result`, `log` and `uuid` are leaves that any area may import. `link` never imports `session`.
Instead it reports to its owner through `LinkOwner`, a typed interface of five callbacks declared in
`link/link.ts`.

Fan-out: the root has 13 entries (6 leaf files and 7 areas). Each area has 3–11 files. The tree is
at most two levels deep below `src/`.

```
src/
  index.ts            Public surface, named exports only. No state.
  defaults.ts         Every default and internal cap (client, server, session, stores), one line of why each. No state.
  result.ts           Result<T>, VoidResult, errorFrom(): a thrown value turned into a result. No state.
  log.ts              SmppLog, silentLog, guardedLog. No state.
  uuid.ts             uuidv7(). State: the monotonic counter within one millisecond.
  bounded-store.ts    BoundedStore<V>. State: entries, total weight, sweep timer. Invariants: count <= max and weight <= maxWeight
                      after every write; expired entries are gone before admit() decides; the entry being written is never
                      dropped; every drop goes through onDrop exactly once.
  wire/               The codec: bytes <-> PduObject. Stateless apart from PduFramer. (11 files)
    commands.ts       The 33 commands, their ids and params in WIRE ORDER (never sorted).
    constants.ts      consts + constsById, the interface versions.
    fields.ts         Named bit fields of esm_class, data_coding and registered_delivery, one line of meaning each.
                      Replaces hasUdh/messageTypeOf/messageClassOf's inline masks.
    errors.ts         ESME_* status table, ordered by id.
    tlvs.ts           TLV table, ordered by id; typed read/input shapes.
    tlv-stream.ts     Reading and writing a TLV stream. Split out of tlvs.ts.
    types.ts          Integer and C-Octet String wire types.
    array-types.ts    dest_address and unsuccess_sme arrays. Split out of types.ts (684 lines).
    pdu.ts            pduToObj / objToPdu / pduReturn / isCommand / isResp.
    refusal.ts        PduHeader, PduRefusedError, the status SMPP names for an unreadable PDU, maxPduLength.
    framer.ts         PduFramer. State: the partial-PDU buffer. Invariant: yields only whole PDUs; one bad length poisons the stream.
    defs.ts           `defs`: every table as one group.
  text/               Message bodies: alphabets, splitting, concatenation, times. Stateless. (9 files)
    gsm7.ts           GSM 03.38 codec, named for what it is. The public EncodingName 'ASCII' maps to it in one line in alphabets.ts.
    latin1.ts, ucs2.ts  One codec each.
    alphabets.ts      detect, unencodable, encodingByDataCoding, dataCodingByEncoding.
    split.ts          splitMessage, bitCount, the 153-septet/134-octet segment budget (see §5).
    udh.ts            UDH length and concat fields; ConcatReference. State: the 8-bit reference counter.
    concat.ts         concatOf(): UDH or sar_*, which spelling.
    body.ts           messageOctets, decodeMessage, decodeSegments: where a body is and how it reads.
    smpp-time.ts      smppDate, smppTime encode/decode.
  receipts/           Delivery reports. (4 files)
    receipt-text.ts   parseReceipt, receiptCodes, the researched stat: aliases (FAILED, DELIVERD).
    dlr.ts            dlrFromPdu: what marks a receipt, final vs intermediate.
    sms-id.ts         Id notations, <base>-<n> segment ids, which response carries an id.
    merger.ts         DlrMerger. State: expected groups plus the `spent` bases (two BoundedStores). Invariant: a base
                      merges at most once; an intermediate report never fills a slot. `close()` is renamed `spend()`.
  link/               One socket's life. Everything here dies with the socket. (9 files)
    link.ts           Link and LinkOwner. State: phase (binding|bound|gone), gone-reason. Composes the files below.
                      Invariant: the phase only moves forward, and owner.onGone fires exactly once.
    transport.ts      Socket plus framer. State: none beyond the socket. The only write path to the socket.
    timers.ts         enquire_link heartbeat and idle timeout. State: two timers. Cleared when the phase is gone.
    pending.ts        Sequence numbers and correlation. State: next seqNr, seqNr -> waiter. Invariant: every waiter settles
                      once (answered, timed out, aborted, or unanswered when the link goes).
    bind.ts           The bind record {as, peerVersion}, checkedBind, bindCarries, standsInFor. State: the record. Set once.
    answers.ts        The answer ledger. State: owed requests by seqNr. Invariant: every inbound request gets exactly one
                      response on this link, or none because the link went; a second answer returns err.
    inbound.ts        Routes each inbound request to its one answer: onRequest hook, bind direction, enquire_link, unbind,
                      submit/deliver/data_sm, unknown commands. Stateless apart from what it calls.
    handlers.ts       Running onSms handlers. State: running set (a BoundedStore, 'refuse' policy), the refusing
                      hysteresis flag. Invariant: at most maxHeldMessages/maxHeldOctets run at once; the drain waits for zero.
    reassembly.ts     Reassembler. State: incomplete groups (a BoundedStore). Invariant: a segment is answered only once
                      it is kept; a group lost after answering is reported as lost traffic.
  session/            What the application holds: one Session over a sequence of Links. (9 files)
    session.ts        Session. State: life, current link, last bound link, lifetime AbortController. Owns the transitions
                      open -> closing -> ended, and the link handover. Public events are emitted here and nowhere else.
    link-wait.ts      LinkWait. State: sends waiting for a bound link. Invariant: each settles on the next bound link, its
                      own deadline or signal, or lifetime abort.
    window.ts         SendWindow (maxOutstanding). State: in-flight count, FIFO queue. Invariant: in-flight <= max.
    outbound.ts       The one request path: admit -> wait for a link -> slot -> write -> answer; retry only if unwritten.
                      UnansweredError. No state of its own.
    reconnect.ts      Backoff. State: delay, upAt, timer. Stopped only through the lifetime signal.
    shutdown.ts       The drain order and budgets as one function over (handlers, window, lifetime). No state.
    sms.ts            The Sms handle given to onSms: fields, sendDlr(). No state beyond the message.
    send-sms.ts       submitSms composition, submitSmParams.
    options.ts        SessionOptions, ReconnectOptions, CloseOptions, SendOptions, checkSessionOptions.
  client/             (3 files)
    client.ts         client(): compose, fromStart.
    connect.ts        Open a socket: TCP/TLS, connectTimeout, abort.
    bind.ts           The ESME's bind_* request and what a refusal means.
  server/             (3 files)
    server.ts         server(), SmppServer. State: the listener and the live sessions set.
    listen.ts         Listener creation, TLS, startup errors.
    accept-bind.ts    authenticate, bind response, pre-bind refusals.
docs/glossary.md      ESME, SMSC/MC, PDU, bind types, esm_class, data_coding, UDH, sar_*, TLV, message_state, receipt, segment, link, session.
```

## 3. Public API changes

These are the only changes. `client()` still resolves `{ err, session }`, `Session` keeps its events
(`close`, `disconnected`, `reconnected`, `dlr`, `messageDlr`, `sessionError`, `data`, `incomingPdu*`),
and the codec exports stay.

1. **`session.on('sms')` plus `sms.sendResp()` becomes an `onSms` option.** The option is accepted by
   `client()`, `server()` and `new Session()`.
   - Old: `session.on('sms', async sms => { await sms.sendResp({ smsId }); })`.
   - New: `onSms: sms => ({ smsId })` (sync or async). Returning nothing answers `ESME_ROK` under a
     generated id. `{ status }` refuses the message.
   - A handler that throws or rejects refuses the message with the retry status: `ESME_RTHROTTLED` on
     a submission, `ESME_RX_T_APPN` on a delivery. The error also goes to `sessionError`.
   - With no `onSms`, the same retry status goes out at once. That needs a decision in
     `docs/decisions.md` resting on goal 2 ("work the peer has no reason to send again is not dropped")
     and goal 4. Today no listener means no answer, and the peer's own timeout decides.
   - Reason: it removes the held-message timing contract (lessons 1–2) and the `captureRejections`
     WeakMap. Goals 2 and 5.
2. **`sms.sendDlr()` before the message is answered returns `err`:** "report after onSms returns". The
   answer is what gives the peer the id that the receipt names. Reason: without this rule there would
   be a second answering path (F kept `sendResp()` for an early answer, which is two spellings of
   answering). Goal 1.
3. **`session.sendReturn()` on a request that is already answered, or on a message whose `onSms` is
   still running, returns `err`.** Today it writes a second response. Reason: principle 5, since the
   ledger's invariant is also the public promise. Goals 1 and 4.
4. **`sms.answeredOnArrival` stays.** For a message whose segments were answered on arrival, a
   returned `smsId` or refusing `status` goes to `sessionError`, where today `sendResp()` returns it as
   an `err`.

Kept on purpose: the `Session` name, `boundAs`/`peerInterfaceVersion` surviving the reconnect gap (now
read from the last bound Link), the `sock` getter (the current or last Link's socket), and the
`reconnect.connect`/`onConnected` constructor options. F's rename to `SmppClient` did not move the
mean (6.25 = main), so its cost buys nothing a reader scores. MIGRATION.md and CHANGELOG.md record
changes 1–4.

## 4. Where each thing goes

| Now | New home |
| --- | --- |
| session.ts | session/session.ts (life, handover, events); the dispatch moves to link/inbound.ts, the refusal answer to link/answers.ts, the drain to session/shutdown.ts |
| link-life.ts | Split: the phase goes to Link.phase; waiting for a link goes to session/link-wait.ts; `stopped` and `retrying` go to Session.life plus lifetime; `generation()` is deleted, because a message holds its Link object |
| client.ts | client/client.ts, client/connect.ts, client/bind.ts; `bindOn`'s ordering comment is deleted (principle 3) |
| server.ts | server/server.ts, server/listen.ts, server/accept-bind.ts |
| incoming-requests.ts | link/inbound.ts (routing); throttled and refused-segment statuses go to link/handlers.ts and link/reassembly.ts; `reportLost` becomes LinkOwner.onLost |
| held-messages.ts, sms.ts (MessageHold) | link/handlers.ts (the running set and bound); session/sms.ts (the handle); answering goes to link/answers.ts |
| outgoing-requests.ts | session/outbound.ts; `requestPastDrain`/`requestOnCurrentLink` become one `request(input, { lane })`, with `lane: 'app' | 'receipt' | 'bind' | 'unbind'` and a single `admit(lane, life)` table |
| pending-requests.ts | link/pending.ts (per link, so linkLost is the Link going) |
| send-window.ts, idle-waiters.ts | session/window.ts; the idle wait is inlined there and in link/handlers.ts (the abort dance is copied, per the existing decision) |
| link-timers.ts | link/timers.ts |
| reconnect-loop.ts | session/reconnect.ts; `halted` is deleted in favour of the lifetime signal |
| pdu-transport.ts, pdu-framer.ts | link/transport.ts (no `attach`: one socket per Link), wire/framer.ts |
| pdu.ts, pdu-refusal.ts, retained-pdu.ts | wire/pdu.ts, wire/refusal.ts; `detach`/`retainedOctets` go to bounded-store's weigher callers in link/ |
| expiring-groups.ts | bounded-store.ts |
| reassembly.ts | link/reassembly.ts; `decodeSegments` goes to text/body.ts |
| dlr-merger.ts, dlr.ts, sms-id.ts | receipts/merger.ts, receipts/dlr.ts plus receipt-text.ts, receipts/sms-id.ts |
| message.ts, message-body.ts, udh.ts, concat.ts | text/split.ts plus smpp-time.ts, text/body.ts, text/udh.ts, text/concat.ts |
| send-sms.ts | session/send-sms.ts |
| session-options.ts | session/options.ts; `defaults` goes to defaults.ts; bind helpers go to link/bind.ts |
| error-from.ts, unanswered-error.ts | result.ts, session/outbound.ts |
| log.ts, result.ts, uuid.ts | unchanged at the root |
| defs/* | wire/*, with defs/encodings.ts split into text/gsm7.ts, latin1.ts, ucs2.ts and alphabets.ts, and masks into wire/fields.ts |

The responsibilities the panels named hard:

- **Held messages and answering:** link/answers.ts owns the one answer; link/handlers.ts owns the
  running handler and its bound; link/inbound.ts calls the two in sequence.
- **Lifecycle and reconnect:** session/session.ts (life plus handover), link/link.ts (phase),
  session/reconnect.ts (backoff).
- **The drain:** session/shutdown.ts.
- **Outgoing requests and retry:** session/outbound.ts (one loop), link/pending.ts (correlation),
  session/window.ts, session/link-wait.ts.
- **Reassembly and ExpiringGroups:** link/reassembly.ts on bounded-store.ts.
- **Receipts and merging:** receipts/.
- **Codec:** wire/.
- **Encodings:** text/.
- **Defaults:** defaults.ts.
- **Domain knowledge:** docs/glossary.md plus wire/fields.ts.

## 5. The hard parts that stay hard

Each hard part has an `Invariant:` paragraph above the class or function that owns it. AGENTS.md
gains a "Hard parts" index of one line per entry, giving the file and the invariant.

1. **Exactly one answer, with multipart answered on arrival** (link/answers.ts, inbound.ts). A relaying
   SMSC waits for each segment's answer, so segments are answered before the whole message exists, and
   the handler's answer then has nothing left to write. All of it is in two adjacent files; the ledger
   refuses the second answer loudly.
2. **Retry only what was never written** (session/outbound.ts). This is goal 2's "never re-send what
   the peer may have taken". The loop: `boundLink()`, then a slot, then `link.write()`. An `unwritten`
   result from a gone Link loops back to `boundLink()`. A written request that fails is
   `UnansweredError`. The loop reads no link predicates; the Link's own result says what happened.
3. **The drain** (session/shutdown.ts): handlers first (answering can emit a receipt), then the window,
   under one deadline. `shutdownTimeout: 0` never makes the handler wait forever. It is one function,
   with the order and each budget commented once.
4. **The link handover** (session/session.ts `adopt(link)` / `onGone(link, reason)`). This is the only
   place where `current` changes. The link-wait releases on `adopt`; `disconnected` or `close` is
   emitted last.
5. **Backoff reset only after a link has outlasted `maxDelay`** (session/reconnect.ts). The existing
   decision is linked from there.
6. **Bounded stores under pressure** (bounded-store.ts, and each owner's drop policy). Reassembly now
   refuses a segment that would force its own group out, where today it evicts that group; the peer
   keeps and retries it. The eviction of older groups is reported as lost traffic through onDrop.
7. **The segment budget** (text/split.ts): 153 GSM septets unpacked versus 134 octets, as AGENTS.md
   explains.
8. **data_coding and esm_class** (wire/fields.ts): coding groups and message classes, named and
   glossed.

## 6. Build order

Each chunk is green on its own and is one PR.

1. **Words first, with no behaviour change.** docs/glossary.md, a citation sweep, wire/fields.ts,
   defaults.ts, and `gsm7`/`spend` renames. Re-run the panel cheaply on this alone to learn how much
   Self-sufficiency moves.
2. **BoundedStore replaces ExpiringGroups.** Port Reassembler, DlrMerger and HeldMessages to it; tests
   for the own-entry refusal.
3. **Mechanical move into wire/, text/, receipts/.** Imports only, plus the types.ts and tlvs.ts
   splits.
4. **The contract.** `onSms` option, link/answers.ts, link/handlers.ts, session/sms.ts; `sms` event and
   `sendResp()` removed; tests and README examples ported (draft-f's `port-session-test.py` and API map
   help here); the no-handler decision recorded.
5. **Link.** link/link.ts owns the per-socket state (transport, timers, pending, bind, answers,
   handlers, reassembly); Session gets `life`, `current`, `lifetime`, `adopt`/`onGone`; LinkLife is
   deleted; reconnect.ts reads the signal.
6. **One request path.** session/outbound.ts with lanes, link-wait.ts, shutdown.ts.
7. **Client and server folders**, then the docs pass: README (Receive SMS, Server, Shutdown), MIGRATION,
   CHANGELOG, decisions (retire LinkLife-era entries, add the onSms and ledger decisions), and the
   AGENTS.md architecture and hard-parts index.
8. **Panel.**

## 7. Predicted panel risks

- **Session versus Link vocabulary.** A junior may not see why the public thing is a "session" and the
  inner one a "link". The glossary defines both, and link/link.ts's invariant paragraph says "one
  socket; a Session outlives many". It could still cost a Navigation point.
- **session.ts stays the biggest hub.** It composes link-wait, window, reconnect, merger and the
  handover, so readers will rank it hardest. The mitigation is that it holds three fields and two
  transition methods; the target is under 250 lines.
- **LinkOwner is a callback interface.** E's lesson was that meaning split across callbacks in another
  file is hard. The mitigation is five callbacks, each with one line in link.ts, all implemented
  side by side in session.ts. A seat may still call it indirection.
- **Lanes in outbound.ts.** Four lanes are still four rules, but they are in one table; round 2 cited
  lanes spread over methods.
- **The sendDlr rule is a friction point** for test-double servers that want to report immediately.
  The README must show the pattern (report after the handler returns), or seniors will call it a trap.
- **The public name 'ASCII'** still says ASCII for GSM 03.38. Renaming it is a breaking change this
  plan does not take; alphabets.ts carries the one-line mapping.
- **The new own-entry refusal policy** is a behaviour change under pressure. It needs a test and a
  decision entry, or the architect seat will flag it as unreasoned.
- **The scale is coarse.** Chunks 1–3 may lift juniors' Self-sufficiency to 6 and nothing else. The
  full point needs chunks 4–5 to lift Locality to 6 in every seat, and to 7 in two.
