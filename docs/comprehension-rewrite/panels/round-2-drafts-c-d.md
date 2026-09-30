# Round 2: drafts C and D

## Draft C, junior seat

1. **Hardest places, ranked hardest first**

   1. **`src/session.ts:336-404` (`drain`, `dropSocket`, `linkLost`, `end`), `comeBackUp` at `:303`, and `src/session/link-life.ts:17-82` (`LinkLife`'s phase plus its predicates).** Link state is a four-value `Phase` plus a separate `stopped` flag. Seven predicates read it: `isAttached`, `isUp`, `isOver`, `isStopped`, `retrying`, `awaitsNextLink`, `refusal`. On top of that, `OutgoingRequests.canCarry()` adds `!sock.destroyed`. To follow `comeBackUp`'s `!this.link.retrying() || !this.link.isUp()` (`:319`) or `drain`'s two `canCarry()` checks, I had to hold every phase transition at once. `linkLost` is order-dependent ("Read first: a `disconnected` listener may close() the session"), so a synchronous listener re-enters the session in the middle of the method. The comments resolved each line on its own. The whole state machine never became clear to me; I would need to draw it.

   2. **`src/session/outgoing-requests.ts:83-150` (`request`, `carry`, `attempt`).** The three lanes, the `for(;;)` retry loop, `window.release()` in a `finally`, and `pending.wait()` registered before `write()` all interact. The loop-exit comment at `:118` ("Until the link is dropped it admits the retry straight back onto the dead socket, and the loop spins") took three rereads. The `Lane` doc comment at `:20-26` rescued the lanes. The retry exit stayed half-opaque.

   3. **`src/session/incoming-requests.ts:103-271` (`handle`, `route`, `onDelivery`, `onMessage`, plus `refusedSegmentStatus` at `:28`).** This is where the domain costs the most. `data_sm` routes by `carriedAs`. `deliver_sm` might be a receipt or a message, and `onDelivery` falls through to `onMessage`. The status codes come as a family: `ESME_RX_P_APPN`, `ESME_RX_T_APPN`, `ESME_RTHROTTLED`, `ESME_RINVTLVVAL`, `ESME_RINVESMCLASS`. The `arrivedOn` socket-identity check at `:111` is state compared across an `await`. The flow reads cleanly, but I only knew why each status was right after reading README "Receiving in depth" and "Server in depth".

   4. **`src/messages/reassembly.ts:110-206` (`Reassembler.collect`, `trim`) with `src/messages/expiring-groups.ts:70-88` (`weigh`).** `weigh()` can evict the group currently being added to. `trim` then counts `parts.size - 1` for that group, because the segment just added is refused and so is not lost. The contract is split across two classes: `ExpiringGroups` "enforces neither max nor timeout itself", so every owner must remember to call `full` or `takeExpired`. It resolved after reading the `ExpiringGroups` doc comments. Action at a distance, but it is marked.

   5. **`src/messages/dlr.ts:157-238` (`messageType`, `receiptStatus`, `dlrFromPdu`).** A four-value `MessageType` is derived from `esm_class` bits and then from a TLV. The TLV state and the body's state take precedence over each other in different ways. `statusId` falls back to `UNKNOWN`, and an `unmarked` PDU without both an id and a state is not a receipt. The comments cite spec sections (5.3.2.26, Appendix B) that I cannot open. The README `Dlr` field table is what finally made the output shape make sense.

   6. **`src/client.ts:219-322` (`bindOn`, `initialAttempts`, `keepTrying`).** There are two routes into `ReconnectLoop`: the session's own, and a second one here that builds a fresh `Session` per attempt. There is closure state (`lastErr`, `settled`) and abort-listener bookkeeping. The comment at `:241` ("close() must reach the loop's stop() before its first await") depends on how `Session.close` is ordered inside, in another file. It stayed partly opaque.

   7. **`src/wire/pdu.ts:84-136` (`resolveShortMessage`, `resolveBody`).** `CodingSource` decides whether `short_message` or `message_payload` owns `data_coding`. The cases are Buffer or string, empty or not, crossed with a string TLV being present. That is four or more branches returning objects that are almost the same. The `CodingSource` doc comment helped, but only after I had read `messageOctets()` in `message-body.ts`.

   8. **`src/defs/encodings.ts:151-190` (`messageClassOf`, `messageClassEncoding`, `encodingByDataCoding`).** Bit masking over GSM 03.38 coding groups, which I had no context for. `messageClassEncoding` has a `//` comment and a `/** */` comment stacked on top of it that say different things. It stayed opaque, and I would trust the tests over my reading.

2. **The unit I'd least want to modify:** `Session.linkLost`, `dropSocket` and `end` (`src/session.ts:366-404`) together with `LinkLife`. They are re-entered from the transport (close, error, unreadable), from `LinkTimers.onIdle`, from `comeBackUp`, from `unbind` and `close`, and synchronously from application listeners (`disconnected`, `close`). The correctness depends on call order and on idempotence guards (`drop()` returning false, `end()` returning false). None of that is visible at any single call site.

3. **Expected hard, found easy:**
   - The codec in `defs/types.ts`: 684 lines, but it is one pattern repeated (read, size, write, all returning Results).
   - `PduFramer`.
   - The no-throw `Result` convention, which is applied the same way everywhere.
   - `send-sms.ts`: `checkOptions` is a flat chain of guards.
   - `bind-direction.ts`.
   - The folder layout. The AGENTS.md architecture map matched the files one to one, and a one-line purpose per file made cold navigation fast.

4. **Prose debt**
   - **What I needed and what it cost:**
     - The basic domain vocabulary: ESME vs SMSC/MC, bind types, what `deliver_sm` doubles as, `esm_class`, `data_coding`, UDH vs `sar_*`, `registered_delivery`. There is no glossary anywhere. I rebuilt it from README "Receiving in depth", "Delivery receipts" and "Bind direction", which cost a pass over a 764-line README with a lot of jumping.
     - The AGENTS section "GSM 7-bit is sent unpacked", which was essential for `segmentUnits` in `message.ts`.
     - Many code comments cite SMPP section numbers with no summary, so they are pointers I could not follow.
     - The AGENTS decision index names choices, for example "Every request leaves through one `request()`, in one of three lanes", whose reasoning is in `docs/decisions.md`, which was out of bounds. The titles alone helped a little.
     - I did not open any test.
   - **Prose that added nothing the code didn't already say:**
     - The seven `declare` listener lines in each emitter class.
     - `OutgoingRequests.deliver` ("False means nothing was") and `PendingRequests.deliver`, both restating their code.
     - README's "Everything exported" table, which repeats `index.ts`.
     - The AGENTS Conventions paragraph about test fixtures, for reading `src/`.
     - The 0.4.0 defect table, which is history and says nothing about the current code's structure.

5. **Scores**
   - **Navigation: 7.** It sits at "predictable": the `session/`, `messages/`, `wire/`, `defs/` split plus the per-file map in AGENTS.md got me from a symptom to a file on the first try. It stays below 8 because concatenation logic is split three ways (`concat.ts`, `udh.ts`, `reassembly.ts`), refusal statuses are split between `pdu-refusal.ts` and `incoming-requests.ts`, and `udh.ts` holds `ConcatReference`.
   - **Locality: 6.** It is between "honest middle" and "predictable". The hard parts are marked, but `IncomingRequests` holds the `Session` and calls back into it (`emit`, `sendReturn`, `close`, `sock`, `linkEnd`). `LinkLife` is shared by `Session` and `OutgoingRequests`. `ExpiringGroups` depends on its owners to sweep. `linkLost` is re-entrant through listeners.
   - **Shape: 6.** Files are small and fan-out is bounded, but some names mislead:
     - The GSM7 codec is called `ascii`.
     - `ExpiringGroups<true>` is used as a "spent" set.
     - `linkLost()` means something different in `Session`, `OutgoingRequests` and `IncomingRequests`.
     - `refusal()` returns an `Error` on `LinkLife` and an `ErrorName` on `IncomingRequests`.
     - `IdleWaiters.settle()` wakes waiters whatever the count reads.
   - **Self-sufficiency: 5.** Honest middle. The comments are dense and often state invariants. But for a reader with no SMPP background, the domain terms and bare spec citations mean the README has to stay open beside `incoming-requests.ts`, `dlr.ts` and `encodings.ts`.
   - **Overall: 6.** Capped at self-sufficiency plus one. The layout and conventions are clearly cared for; what costs a junior is the lifecycle state machine and the unexplained domain.
   - **Intrinsic difficulty:** high. It is an asynchronous protocol session with reconnect, drain, windowing and reassembly under hostile input. That gets no bonus in the scores above.

SCORES nav=7 loc=6 shape=6 self=5 overall=6

## Draft C, mid seat

1. **Hardest places, hardest first**

1. **`src/session.ts:303-404`: `Session.comeBackUp` / `drain` / `dropSocket` / `linkLost` / `end`.** Whether the link is alive is held in four places:
   - `LinkLife.phase`, which is `binding`, `up`, `down` or `ended`
   - `LinkLife.stopped`
   - `ReconnectLoop.halted`
   - `transport.sock.destroyed`

   Order matters in several spots, and only comments say so. `linkLost` reads `retrying()` before the drop because a `disconnected` listener may call `close()`. `comeBackUp` checks `!retrying() || !isUp()` after `bind()`. That only makes sense once you find that `bind()` reaches `session.bound()`, which calls `link.open()` out of sight. `canCarry()` (`outgoing-requests.ts:58`) asks both `link.isUp()` and `sock.destroyed`, and nothing explains why both are needed. The comments helped, but I had to trace the state by hand and it is still not fully clear to me.
2. **`src/session/outgoing-requests.ts:83-150`: `OutgoingRequests.request` / `carry` / `attempt`.** The loop in `carry` has three waits: the link budget, a window slot, and the response. The window slot is released in a `finally`, and a retry is allowed only when `attempt.retry && link.awaitsNextLink()`. You need LinkLife's phase logic in your head (`link-life.ts:71-82`) to see why the loop ends. The comment "the loop spins" warns about it but does not explain it. The three lanes are well documented in the `Lane` type's comment (line 25). This resolved, slowly.
3. **`src/wire/pdu.ts:84-136`: `resolveShortMessage` / `resolveBody`.** The code decides whether `short_message` or `message_payload` owns `data_coding`. An empty Buffer means `message_payload`, and a string body gets encoded and can overwrite `data_coding`, but only for one of the two sources. I had no domain context and read it three times. The `CodingSource` comment helped, and the README "Building" bullets confirmed what it is meant to do.
4. **`src/session/incoming-requests.ts:103-271`: `handle` / `route` / `onMessage` / `refusedSegmentStatus`.** A `data_sm` becomes `submit_sm` or `deliver_sm` depending on `linkEnd` (via `standsInFor`). A `deliver_sm` that is not a receipt falls through to `onMessage`. The status codes (`ESME_RX_T_APPN`, `ESME_RTHROTTLED`, `ESME_RINVTLVVAL`, `ESME_RINVESMCLASS`) are domain rules I cannot check. The class also calls back into `Session` through `sock`, `emit`, `sendReturn` and `close`. The socket-identity check after the `onRequest` await was clear once the comment was read. The status choices stayed opaque; I trusted README "Receiving in depth".
5. **`src/messages/reassembly.ts:110-206` with `expiring-groups.ts:70-88`: `Reassembler.collect` / `trim` and `ExpiringGroups.weigh`.** The rules are split between the two classes:
   - ExpiringGroups enforces neither max nor timeout, and its owners must.
   - `set()` resets weight to zero.
   - `weigh()` may evict the key you are weighing.
   - `trim` works out `answered = parts.size - 1` for the current group.

   The comments state each rule, but I needed all of them at once. This resolved.
6. **`src/messages/dlr-merger.ts:105-185`: `DlrMerger.collect` / `open` / `spend`.** There are two stores (`groups` and `spent`), and `spend()` is the exit for four different situations: completion, expiry, reuse and eviction. The class docblock and the `severity` comment explain it. This resolved.
7. **`src/defs/encodings.ts:162-190`: `messageClassEncoding` / `encodingByDataCoding`.** This is bit-level decoding of `data_coding`. The comments say which bits are which but not the table behind them. The code is short, but it stayed opaque without the GSM 03.38 spec.
8. **`src/client.ts:220-322`: `bindOn` / `initialAttempts` / `keepTrying`.** A second `ReconnectLoop` is built outside the session for `fromStart`. `bindOn` depends on `close()` reaching `stop()` before its first await, which the comment at line 241 states. There are also two abort listeners with different lifetimes. This resolved with effort.

I did not open any tests.

2. **Unit I would least want to modify:** the session lifecycle cluster, `Session.linkLost` / `dropSocket` / `end` / `comeBackUp` together with `LinkLife`. Every change there interacts with the reconnect loop's own stopped flag, with the drain's `canCarry()` checks before and after it waits, and with whatever an event listener does during `emit`. Tests would be the only way to know a change is safe.

3. **Expected hard, found easy:**
   - `PduFramer`
   - the parse path in `pduToObj`/`parsePdu`
   - `PendingRequests`
   - `SendWindow`
   - `ReconnectLoop` backoff
   - the listener guards that stop an application listener's throw or rejection from escaping (the no-throw rule)
   - the `defs/` tables
   - `defs/types.ts`, which is 684 lines but repetitive and predictable

   The rule that nothing throws makes every call site easy to read.

4. **Prose debt**
   - **Needed:**
     - README "Shutdown" and "Sends and the link", to understand the lanes and the drain.
     - README "Receiving in depth", for which way a `data_sm` goes and the throttle statuses.
     - The AGENTS architecture map, which is accurate and was the best way in.
     - The AGENTS decision index lines, such as "Every message is answered on arrival" and "One owner decides whether a link can carry a request". They gave intent cheaply because each is one line.
   - **Cost to find:** low, because the map and the index point to the right places. The code's references to spec sections (e.g. "SMPP 3.4 5.2.19") assume a document I do not have.
   - **One false claim:** AGENTS says "`wire` uses `defs`, `messages` uses `wire`", but `wire/pdu.ts:10` imports `decodeMessage` and `encodeBody` from `messages/message.ts`. So wire and messages depend on each other.
   - **Told me nothing:**
     - the AGENTS 0.4.0 defect table (history, not needed to read the current code)
     - most of the test-convention prose in AGENTS
     - the README feature bullets
     - one-line docstrings that restate the method name, such as `isStopped` and `get sock`
   - **Duplicated code:** `quoted()` is duplicated in `bind-direction.ts` and `session-options.ts`. `collectSent` and `collectReceipt` are near-copies.

5. **Scores**
   - **Navigation: 7 (Predictable).** The AGENTS file map matches the layout, and the `session/` / `messages/` / `wire/` grouping took me straight to the right file. It falls short of 9 because answering a request is split across `server.handleRequest`, `IncomingRequests.unhandled` (`ESME_RALYBND`) and `Session.refuse`.
   - **Locality: 6 (between 5 and 7).** The collaborators are small and injected. But link liveness is spread over `LinkLife`, `ReconnectLoop.halted` and `sock.destroyed`, and three comments carry order rules: "Read first", "must reach stop() before its first await", and "the loop spins". `IncomingRequests` also reaches back into `Session`.
   - **Shape: 7 (Predictable).** Fan-out at each level is bounded, and the `Session` constructor wires seven named collaborators. Some names mislead:
     - the GSM codec is called `ascii` (`encodings.ts:45`)
     - `idle` means three different things: `IdleWaiters`, `ExpiringGroups.idle()` and the `LinkTimers.idle` timer
     - the near-synonyms `stop`, `end`, `close`, `release`, `linkLost` and `dropSocket` blur which one is final
   - **Self-sufficiency: 7 (Predictable).** Almost every non-obvious branch carries a one-line reason, often with a spec section. The lanes, the drain and the refusal statuses still needed the README open beside the code.
   - **Overall: 6.** It is capped by Locality. The lifecycle corners are marked, but they are not contained.

   The problem is hard in itself: a protocol full of peer quirks, plus async lifecycle with reconnect and drain. That gets no bonus here.

SCORES nav=7 loc=6 shape=7 self=7 overall=6

## Draft C, senior seat

1. **Hardest places, ranked**

   1. **`src/session.ts:303-404`, the `Session` lifecycle: `comeBackUp`, `drain`, `stop`, `dropSocket`, `linkLost`, `end`.** Whether the session is still alive is spread across three places: `LinkLife`'s phase and its separate `stopped` flag, `ReconnectLoop.halted`, and `link.end()`. To follow any one of these methods I had to hold all three. `comeBackUp:319` tests `!retrying() || !isUp()`. That only makes sense once you know `isUp()` got set as a side effect: the `onConnected` callback in `client.ts:bind` calls `session.bound()`, which calls `link.open()`. The ordering is load-bearing in several places. `linkLost:379` has to read `retrying()` before the drop. `end()` calls `dropSocket()`, which is also a guard. `client.ts:241` says "close() must reach the loop's stop() before its first await". The comments at the call sites marked each ordering rule. None of them explained why the whole thing is split this way. It stayed expensive to read.
   2. **`src/session/outgoing-requests.ts:83-121`, `request` / `carry`, together with `src/session/link-life.ts:34-186`.** `LinkLife` exposes six overlapping predicates: `isAttached`, `isUp`, `isStopped`, `retrying`, `awaitsNextLink` and `refusal`. The lanes mix them. `message` checks `refusal() ?? isStopped()`. `receipt` skips both checks up front and only meets `refusal()` inside `budget()`. `link` skips everything. The loop exits on `!attempt.retry || !awaitsNextLink()`. The comment about it spinning helped, but I had to walk the phase transitions by hand to convince myself. The `Lane` doc comment resolved what each lane is for. It did not resolve what each lane actually checks.
   3. **`src/messages/expiring-groups.ts:18`, `ExpiringGroups`, with `src/messages/reassembly.ts:110-136, 187-206`, `Reassembler.collect` / `trim`.** The store says outright that it enforces neither its `max` nor its timeout itself. The owner has to check `full`, call `takeExpired()`, and let `weigh()` evict, and `weigh()` can evict the very group being written. In `trim`, `answered = size - 1` for the current key, and the refused segment has already been `set` into the group. That is an invariant spread across two files. The doc comments state the contract honestly, so it was readable, just slow.
   4. **`src/wire/pdu.ts:84-136`, `resolveShortMessage` / `resolveBody`.** Deciding which field is allowed to set `data_coding` goes through `CodingSource`. An empty Buffer `short_message` counts as source `message_payload`. A string body rewrites `data_coding`, but only when it encodes to something non-empty. Three branches return three different param shapes. The `CodingSource` doc comment is the key, and I only understood it after going back to `message-body.ts`.
   5. **`src/messages/dlr-merger.ts:68-184`, `DlrMerger` (`open`, `spend`, `dropOldest`).** It keeps a second `ExpiringGroups<true>` as a tombstone set. `spend()` is called on completion, on expiry, on eviction and on id reuse, and each time it deletes and re-inserts the tombstone. The class doc comment explains why ("merged at most once"). I still had to trace which paths end up in `spend` to be sure a straggler receipt is ignored.
   6. **`src/client.ts:219-322`, `bindOn` / `initialAttempts` / `keepTrying`.** For `fromStart` there are two `ReconnectLoop`s: one in the client and one inside each session. `lastErr` lives in a closure, and `settle` is idempotent. `bindOn` removes its abort listener on failure but deliberately keeps it after success, so a later abort closes a bound session. Only README ("That signal also closes the session once bound") told me that was intended rather than a leak.
   7. **`src/defs/encodings.ts:483-514`, `messageClassEncoding` / `encodingByDataCoding`.** Bit masks over coding groups I had no background in. There is an orphan `//` comment sitting above a `/** */` doc comment. The GSM 03.38 codec is named `ascii`, and "fall back to ASCII" (line 504) actually means GSM7. That misled me until I checked the `encodings` map.
   8. **`src/session/incoming-requests.ts:103-153`, `handle` / `route`.** `arrivedOn` is captured before the application's `onRequest` await and compared afterwards. The `unbind` case closes the session with `AbortSignal.abort()` from inside a handler that the dispatch itself is running. Both have comments, and both still needed a second read to be sure nothing re-enters.

2. **Least want to modify:** the `Session` lifecycle cluster (`session.ts:303-404` plus `LinkLife`). A change to when the link counts as up, stopped or ended touches `LinkLife`, `ReconnectLoop`, `OutgoingRequests.canCarry`, `client.ts` `bindOn`/`bind`, and `IncomingRequests`' `sock` check. Nothing in the types enforces the ordering, so it only lives in the comments.

3. **Expected hard, found easy:** `PduFramer`; the wire types in `defs/types.ts` (long but uniform); TLV read and write, including repeatable tags and keying by id; the reconnect backoff; `bind-direction.ts`; the `Result` convention; `udh.ts` `concatInfo`; `send-sms.ts` validation, which is a flat checklist; `PendingRequests`; `SendWindow`.

4. **Prose debt.**
   - **Documentation I needed:**
     - README "Reconnect" section, to know the abort listener kept alive in `bindOn` is intended.
     - AGENTS "GSM 7-bit is sent unpacked", to trust `segmentUnits` GSM7 153 vs UCS2 134. The one-line comment at `message.ts:13` is close to enough on its own.
     - README "Shutdown", to learn that `drain()` returning `{}` when `!canCarry()` also skips waiting on handlers. The code says "nothing is on the wire", which does not mention handlers.
     - The charter's decision index points at `docs/decisions.md`, which I was not allowed to open. For several decisions I had only the title and had to take the rest on trust.
   - **Where the charter's map is wrong:**
     - It says `messages` uses `wire`. In fact `wire/pdu.ts` imports `messages/message.ts` (`decodeMessage`, `encodeBody`).
     - `decodeSegments` lives in `reassembly.ts` but is used by `sms.ts`.
     - `ConcatReference`, a per-session counter, lives in `udh.ts`.

     Each of these cost a wrong turn.
   - **Prose that told me nothing new:**
     - `send()`'s "Sends a request and resolves with the peer's response".
     - `LinkTimers`' "Keeps a quiet connection honest".
     - `PduFramer`'s "Cuts a byte stream into whole PDUs".
     - The charter's test conventions, which are irrelevant to reading `src/`.
     - Most of the decision-index lines, which restate README behaviour.
     - The 0.4.0 defect table. It is useful history but did not help me read the current code.
   - **Duplicated code:** `collectSent` and `collectReceipt` are near-copies, `quoted()` exists twice, and the `emit` / `captureRejectionSymbol` guards are copied between `Session` and `SmppServer`.

5. **Scores.** The problem is intrinsically hard (SMPP session state, reassembly under memory caps, receipt correlation), and that gets no bonus.
   - **Navigation 7:** near the "predictable" anchor. The `session/`, `messages/`, `wire/`, `defs/` split and the charter's file map took me from symptom to file first try. It is held below 8 by the misplaced units above and the false import-direction claim.
   - **Locality 6:** between the 5 and 7 anchors. Link lifecycle state is split across `LinkLife`, `ReconnectLoop` and `Session`, with ordering rules marked only by comments. `IncomingRequests` reaches back into `session.sock`, `boundAs` and `linkEnd`.
   - **Shape 7:** at "predictable". Fan-out per level is small and most names are honest. It is held there by `ascii` for the GSM codec, "fall back to ASCII", `udh.ts` also holding the reference counter, and six overlapping liveness predicates on `LinkLife`.
   - **Self-sufficiency 7:** at "predictable". Comments cite SMPP sections and state invariants beside the code. Two behaviours (the kept abort listener, the drain skipping handlers) needed README open beside the code.
   - **Overall 6:** a cold senior would be productive within a week and would know to fear the lifecycle cluster. The locality cost there is what holds it below 7.

SCORES nav=7 loc=6 shape=7 self=7 overall=6

## Draft C, architect seat

**Comprehension panel report: Architect, inherited (draft-c, @larvit/smpp)**

I opened no test file. I read every non-test source file under `src/`. I read `defs/types.ts` and `defs/tlvs.ts` by outline plus key sections, and `commands.ts`, `constants.ts` and `errors.ts` only as far as their outline.

## 1. Map from README and file tree only, verbatim

- **Root, the entry points:** `client.ts` has `client()`; `server.ts` has `server()` and `SmppServer`; `session.ts` has `Session`, the orchestrator; `index.ts` is the public surface.
- **Root, cross-cutting:** `result.ts` (Result), `log.ts` (SmppLog), `error-from.ts` (unknown → Error). `defaults.ts` I expect to hold session defaults, and I am unsure how it relates to `session/session-options.ts`.
- **`defs/`:** the SMPP spec tables: commands, TLVs, errors, constants, encodings, wire types.
- **`wire/`:** the codec. `pdu.ts` is pduToObj/objToPdu, `pdu-framer.ts` turns a byte stream into PDUs, `pdu-refusal.ts` is PduRefusedError.
- **`session/`:** what a Session is made of: transport, keepalive timers, reconnect, send window, pending-request correlation, incoming and outgoing requests, bind direction, options. `running-handlers.ts` I guess counts `onSms` promises (README: "1000 handlers", "close() waits for your handlers"). `idle-waiters.ts` and `link-life.ts` are unclear from their names.
- **`messages/`:** message-level logic: encode/split, UDH, concatenation, DLR parse and merge, reassembly, the inbound `Sms` handle, sendSms composition, ids, uuid.
- **Names that do not give their purpose:** `retained-pdu.ts`, `expiring-groups.ts`, `unanswered-error.ts` (why in messages/?), `uuid.ts` (why in messages/?), `pdu-transport.ts` (session, not wire?), `link-life.ts`.
- **README promises I expect to find:** a drain that waits for handlers, then for requests. `smppTime` somewhere in messages. No store (goal 9 says it has not shipped).

## 2. Where the map was wrong, and what each correction cost

| Map claim | Reality | Cost |
|---|---|---|
| `wire/` is the codec | The per-field codec is `defs/types.ts` (684 lines of read/size/write) and `defs/tlvs.ts` (`parseTlvs`/`writeTlvs`). `wire/pdu.ts:10` imports `encodeBody` and `decodeMessage` from `messages/message.ts`, so wire depends on messages. AGENTS.md says the reverse ("`messages` uses `wire`"). | High. I had to reopen `defs/`, and the documented dependency direction is false. |
| `defaults.ts` holds session defaults | It holds every option's default plus `bounds` (limits that are not options). | Low. |
| `session-options.ts` holds option types | It also holds `SessionEvents`, `OnRequest`, `SmsHandler`, and the validation for client and server options (`CheckableOptions` includes `authenticate`, `connectTimeout`, `fromStart`). | Medium. |
| One reconnect concept | `client.ts:278` `keepTrying` runs a second, separate `ReconnectLoop` for `fromStart`. `ReconnectOptions` (session: `connect`/`onConnected`) and the client's `reconnect` (`ReconnectTuning`) are two shapes under one name. | Medium. |
| `running-handlers.ts` counts `onSms` promises | Correct. | None. |
| `messages/` is message logic | It is a 14-file grab-bag with 5 themes: codec helpers, receipts, bounded stores, sending, ids/errors. | Medium. |

## 3. Fan-out, level by level

- **L0, `src/`:** 8 files and 4 directories. It mixes 4 entry points with 4 utilities. Acceptable.
- **L1:**
  - `session/`: 12 files. `Session` composes 7 collaborators plus `ConcatReference`.
  - `messages/`: 14 files across about 5 themes.
  - `wire/`: 3 files.
  - `defs/`: 7 files.
- **L2, inside `session.ts`:** about 25 members. The lifecycle cluster alone (`drain`/`stop`/`dropSocket`/`linkLost`/`end`) touches 6 collaborators.
- **Worst level:**
  - By count and cohesion, `messages/` (14 files).
  - By reading cost, `session/`. `link-life.ts` has 7 near-synonymous predicates, `OutgoingRequests.canCarry` is an 8th, and `ReconnectLoop.isStopped` a 9th.

## 4. Names

**Names that mislead**
- `encodings.ts:45` `ascii` is the GSM 03.38 codec. The comment at `encodings.ts:180` says "alphabets with no codec fall back to ASCII", but the code returns `'GSM7'`.
- `ExpiringGroups` enforces neither the cap nor the expiry; its own doc comment says so at `expiring-groups.ts:18`.
- `defs/` is described as "spec tables" but holds most of the codec.
- `udh.ts` holds the outbound `ConcatReference` counter next to UDH parsing.
- `messages/unanswered-error.ts` is used by `session/outgoing-requests.ts`.

**Concepts with two names**
- `sendSms` and `submitSms` name the same action.
- GSM7 and `ascii` name the same codec.
- "stopped" is held twice: `LinkLife.stopped` and `ReconnectLoop.halted`, both set by `Session.stop()`.
- `smsId`, `message_id` and `base` refer to the same id.

**One name over several concepts**
- `idle`: the `LinkTimers` idle timeout, `IdleWaiters` (a count falling to zero), and `ExpiringGroups.idle()` (stop the sweeper).
- `release`: `SendWindow.release` frees a slot, `RunningHandlers.release` wakes the drain, `LinkLife.release` settles link waiters.
- `settle`: used everywhere.
- `reconnect`: the session's `ReconnectOptions` and the client's `ReconnectTuning`. `checkReconnect` validates only the client shape.

## 5. What I would restructure, ranked

1. **Move the codec into `wire/`:** `defs/types.ts` read/write, `defs/tlvs.ts` parse/write, and `encodeBody`/`decodeMessage`. This makes the documented dependency direction true.
2. **Split `messages/`** into inbound, outbound and receipts. Move `unanswered-error` to `session/`, and move `uuid` out.
3. **Collapse the link predicates** in `LinkLife` into one query per lane (for example `admits(lane)`), absorbing `canCarry` and `ReconnectLoop.halted`.
4. **Split `session-options.ts`:** event and hook types in one place, client/server option checking in another.
5. **Renames:** `ascii` → `gsm7`, `ExpiringGroups` → something that says it only holds keyed deadlines, and distinct names for the `idle`, `release` and `settle` overloads.

**What the structure gets right**
- `Session` is split into collaborators, each with a one-line owner doc.
- `Result` is used uniformly.
- Comments record why at the call site (for example `link-life.ts:173`, `reassembly.ts:162`, `dlr-merger.ts:23`).
- The AGENTS.md file map is accurate at file level.
- Every store is bounded and says so.

## 6. The 3am question

**Time and route, cold:** about 5–10 minutes. README "Shutdown" → `session.ts:267` `close()` → `session.ts:336` `drain()` → `incoming.idle` → `session/running-handlers.ts:54` `RunningHandlers.run` and `:89` `idle`.

**The premise does not match this code.** `sms.sendResp()` does not exist here; a grep for it finds nothing. Every message is answered on arrival (`incoming-requests.ts:233`), and the drain waits for the promise the `onSms` handler returned to settle, not for any answer.

**Likely cause:** a handler whose promise has not settled. The typical case is a handler awaiting `sms.sendDlr()` while the peer never answers the `deliver_sm`: `responseTimeout` (30 s) is longer than `shutdownTimeout` (5 s). The second place to look is the phase after it: `outgoing.idle` → `SendWindow.unfinished()` (`send-window.ts:82`), which counts queued waiters as well as requests on the wire.

**Adjacent hazard (plausible, not confirmed):** `session.ts:340` returns before waiting for handlers when the link cannot carry requests. A `close()` during a reconnect gap therefore skips the handler wait, which README step 2 says always happens. A slow `onRequest` hook is never counted by the drain either.

**Where it rots first:** the lifecycle cluster in `session.ts:336-404`. Its correctness depends on call order: `linkLost` reads `retrying()` before `dropSocket`, and `end` calls `stop` and `dropSocket` before the phase check. Every new link state adds a predicate to `LinkLife`.

**Where the next two features land:**
- Goal 9's store cuts across `DlrMerger`, `Reassembler` and `ExpiringGroups` in `messages/`, and `RunningHandlers` in `session/`. It has no single seam today.
- A per-PDU rate limit (goal 7) becomes a fourth wait in the `OutgoingRequests.carry` loop (`outgoing-requests.ts:100`).

## 7. Hardest places, ranked

1. `src/session.ts:336-404`, `drain`/`stop`/`dropSocket`/`linkLost`/`end`: order dependence, and the early return that skips handlers.
2. `src/session/link-life.ts:50-82`, the `LinkLife` predicates: phase × stopped × reconnects expressed as 7 booleans.
3. `src/session/outgoing-requests.ts:83-121`, `request`/`carry`: 3 lanes and a retry loop whose own comment warns that it spins.
4. `src/session/incoming-requests.ts:103-128`, `IncomingRequests.handle`: holds a Session back-reference, awaits `onRequest`, then re-checks the socket. The session is reachable by two routes: the object and the `sendReceipt` closure.
5. `src/messages/reassembly.ts:110-206`, `Reassembler.collect`/`trim`: eviction by weight, with the `parts - 1` accounting for a segment that was refused.
6. `src/messages/dlr-merger.ts:150-173`, `DlrMerger.open`/`spend`: a second `ExpiringGroups` used as a set of spent ids.
7. `src/wire/pdu.ts:84-136`, `resolveShortMessage`/`resolveBody`: which source's `data_coding` wins.
8. `src/client.ts:250-322`, `keepTrying`/`initialAttempts`: a second reconnect mechanism.

**The unit I would least want to modify:** the `Session` lifecycle cluster, `session.ts:366-404` (`dropSocket`/`linkLost`/`end`).

## 8. Scores

The problem is intrinsically hard: SMPP session lifecycle with reconnect, drain, send window and bounded reassembly. That earns no bonus.

- **Navigation 7.** Sits at "Predictable": the AGENTS.md map and file names took me from symptom to `RunningHandlers` in minutes. It is held below 8 because the codec is split between `defs/` and `wire/`, and `messages/` is a grab-bag.
- **Locality 6.** Between "Honest middle" and "Predictable". The collaborators are real. It is held there by `IncomingRequests` holding a `Session` back-reference, by stopped/up state spread across `LinkLife`, `ReconnectLoop` and `transport.sock.destroyed`, and by the order-dependent `end`/`linkLost`.
- **Shape 6.** Between the anchors. It is held there by the 14-file `messages/`, a `LinkLife` API of 9 predicates, the wire→messages import that contradicts AGENTS.md, and names that lie (`ascii`, `ExpiringGroups`, `idle`/`release` overloads).
- **Self-sufficiency 7.** Sits at "Predictable": the invariants and whys are stated beside the code. It is held below 8 because the drain's early return at `session.ts:340` contradicts the README's shutdown contract, and the file map's layering claim is false.
- **Overall 6.** Capped at 7 by the lowest dimension plus one. It sits at 6 because the hardest code (the lifecycle and the link predicates) is exactly where the order dependence lives.

SCORES nav=7 loc=6 shape=6 self=7 overall=6

## Draft D, junior seat

1. **Hardest places, hardest first**

   1. **`src/handled-messages.ts:92` `HandledMessages.offer`, `:125` `run`, and `src/sms.ts:83` `createSms`.**
      - `offer` creates an object whose own closure sets `handled.answered`. `sendResp` then takes one of two paths depending on `answeredAs` (`sms.ts:97`).
      - After a handler fails, `run` calls `sms.sendResp({ status: retryStatus })` (`:133`). For a multipart message, `answeredOnArrival()` returns an `err` there and nobody reads it.
      - I had to trace three files to see that this is intended: the segments were already answered, so there is nothing left to refuse. No comment at `:133` says so.
      - Still opaque: what "settle" means here, compared with `IdleWaiters.settle`.

   2. **`src/session.ts:239-323`, the shutdown verbs: `unbind`, `close`, `drain`, `finish`, `linkLost`, `dropLink`.**
      - There are six near-synonyms, plus `LinkLife.stop`/`drop`/`end` underneath them. `stop()` gets called twice (in `drain` and again in `finish`).
      - `unbind`'s return line, `sent.err && !closedOnUnbind ? … : drained`, needed a truth table.
      - Re-entrancy: an inbound `unbind` (`incoming-requests.ts:149`) calls `session.close()`, which calls `incoming.drain()` on the same object that is still mid-`route`.
      - Doc comments helped with each piece. The overall state machine was never written down in one place.

   3. **`src/outgoing-requests.ts:120` `refusal()` and `:74` `request()`, with `src/link-life.ts:31` `LinkLife`.**
      - `LinkLife` exposes seven predicates (`isAttached`, `isUp`, `isOver`, `isStopped`, `retrying`, `awaitsNextLink`, `refusal`).
      - Callers mix them with `canCarry()` (which also checks `sock.destroyed`). `refusal()` at `:129` reads `isStopped() && canCarry()`, and its comment ("the link's own refusal names the session closed instead") only made sense once I had held all four phases in my head.
      - Also surprising: the phase starts at `'up'` before any bind. I had to hunt through `comeBackUp` to see that `'binding'` exists only on reconnect.

   4. **`src/reassembly.ts:186` `Reassembler.trim`, with `src/expiring-groups.ts:70` `ExpiringGroups.weigh`.**
      - `ExpiringGroups` is a store whose rules its owners enforce: `set()` never evicts, `weigh()` does, `full` is only advisory, and `onSweep` must call `takeExpired()`.
      - `trim` reweighs the whole group, may evict the group it is working on, and then computes `answered = parts.size - 1` for that one.
      - The `:199` comment explains the `-1`. It took several rereads to see why `open()` evicts by count and `trim` by weight.

   5. **`src/pdu.ts:84` `resolveShortMessage` and `:113` `resolveBody`.**
      - `CodingSource` decides whether `short_message` or `message_payload` gets to set `data_coding`. An empty-string `short_message` flips it to `'message_payload'`.
      - I had to hold four cases at once: Buffer vs string, empty vs not, plus the TLV text. The type comment at `:74` is accurate but dense.
      - I had no domain context for why a body could live in two places. The README's "Where the body is" resolved that.

   6. **`src/client.ts:253` `initialAttempts`, `:276` `keepTrying`, `:218` `bindOn`.**
      - This is a second use of `ReconnectLoop`, separate from the one `Session` owns. It builds a fresh `Session` per attempt, and a `lastErr` closure is shared across attempts.
      - `bindOn` comes with an ordering warning: "close() must reach the loop's stop() before its first await". Checking that required reading `Session.close` → `drain` → `reconnectLoop.stop()`.
      - It resolved once I saw that `fromStart` is the only path into this code.

   7. **`src/dlr-merger.ts:150` `open`, `:166` `spend`.**
      - There are two `ExpiringGroups`, and the second one (`spent`) is a tombstone set. `spend` deletes from both, evicts the oldest tombstone, then re-adds.
      - The class doc (`:62-67`) explains the "merged once" rule. Without it this would have stayed opaque.

   8. **`src/defs/encodings.ts:162` `messageClassEncoding`, `:182` `encodingByDataCoding`, `:45` `ascii`.**
      - Bitmask rules come from a spec I have not read. The codec named `ascii` is actually the GSM 03.38 table (`GSM: ascii`), which misled me at first.
      - I took the comments on trust; I could not check them.

   I opened no tests.

2. **The unit I would least want to modify:** `HandledMessages` together with `createSms` (`handled-messages.ts:92-140`, `sms.ts:83-157`). The "answered" state lives in three places: `answer.done` in the closure, `handled.answered`, and `answeredOnArrival`. They are updated by callbacks across two files. Whether the peer gets exactly one response depends on all three agreeing, and a mistake silently double-answers or never answers a request.

3. **Expected hard, found easy:**
   - The wire codec. `defs/types.ts` is long but repetitive, and every read and write checks its range the same way.
   - `PduFramer` and `PduTransport`.
   - `send-sms.ts`: `checkOptions` is a flat, ordered pipeline.
   - `sms-id.ts`, `concat.ts`, `udh.ts`: small files whose names tell the truth.
   - The "nothing throws" rule makes every call site look the same, so I stopped needing to think about control flow.

4. **Prose debt.**
   - **Needed:**
     - I needed domain background: what a DLR is, `esm_class`, `data_coding`, UDH vs `sar_*`, and why `data_sm` changes meaning with direction. None of it is in `src/`.
     - I found it in README.md sections "Receiving in depth", "Server in depth" and "Delivery receipts". That cost reading about 780 lines to extract about 60 useful ones.
     - Comments cite SMPP section numbers (e.g. "5.3.2.26", "4.6.2") that a junior cannot resolve without the spec.
     - The AGENTS.md architecture list was the most valuable single piece: one line per file, and accurate.
   - **Told me nothing:**
     - Comments that restate the code: `Session.send` "Sends a request and resolves with the peer's response.", `client()` "Connects to an SMSC and binds.", `LinkTimers.clear` context, and `bindCarries`'s doc, which mostly repeats its three lines.
     - The long AGENTS.md "Conventions" paragraph on test fixtures (irrelevant to reading `src/`).
     - The defects table: it is history, not an explanation of the current code, though it did hint at domain pitfalls.

5. **Scores** (the problem's own difficulty is high: a stateful protocol with reconnect, drain and reassembly, and it gets no bonus here):
   - **Navigation 7.** Predictable: the AGENTS.md file map plus descriptive file names got me to the right file first try for almost every question. What holds it below 8: one symptom such as "why was this refused with ESME_RTHROTTLED" is spread across `incoming-requests.ts` (`retryStatus`, `refusedSegmentStatus`), `handled-messages.ts` (`refuses`) and `reassembly.ts` (`Refusal`).
   - **Locality 5.** Honest middle: liveness state in `LinkLife` is read through seven predicates from three classes. `generation()` is captured in closures (`incoming-requests.ts:106`, `:253`), `answered` is mutated through a callback, and ordering constraints are documented only in comments (`client.ts:239`, `session.ts:349`).
   - **Shape 6.** Between 5 and 7: classes are small and fan-out is bounded, but some names mislead. The GSM codec is called `ascii`, and six-plus near-synonymous teardown verbs (`stop`/`end`/`drop`/`finish`/`linkLost`/`dropLink`/`clear`) mark distinctions I had to work out myself.
   - **Self-sufficiency 5.** Honest middle: the code comments give terse, accurate reasons, but the domain model a newcomer needs to read them lives only in README.md and the SMPP spec, so I kept the README open the whole time.
   - **Overall 5.** Capped at 6 by locality; I land at 5 because both locality and self-sufficiency cost me rereads on the stateful session core. The codec and message layers alone would sit near 7.

SCORES nav=7 loc=5 shape=6 self=5 overall=5

## Draft D, mid seat

1. **Hardest places, ranked hardest first**

   1. **`src/session.ts:265-362`: `Session.drain` / `finish` / `linkLost` / `dropLink` / `comeBackUp`, read together with `src/link-life.ts:31-135` (`LinkLife`).**
      - One question, "can a request go out right now?", depends on four pieces of state: `LinkLife.phase` (binding/down/ended/up), `LinkLife.stopped`, `ReconnectLoop.halted`, and `OutgoingRequests.canCarry()`. The last one is `link.isUp() && !sock.destroyed`.
      - `drain()` calls `link.stop()`, then branches on `canCarry()`. `finish()` calls `stop()` again, then `dropLink()`, then `end()`.
      - `comeBackUp` uses `!this.link.retrying()` to mean "close() landed during the rebind". Here `retrying()` is being used as a stand-in for "not stopped", which the name hides.
      - I had to trace every caller by hand to be sure `close` fires exactly once and `disconnected` is never followed by `close` on the same drop. The per-method doc comments helped. Nothing ties the whole state machine together in one place; this stayed the most expensive read.
   2. **`src/outgoing-requests.ts:262-351`: `OutgoingRequests.request` / `refusal` / `attempt`.**
      - A `for(;;)` loop holds one link-wait budget (`link.hold()` returns a closure) plus a window slot, and retries only when `retryOnNextLink && awaitsNextLink()`.
      - `refusal` line 317 (`pastDrain !== true && isStopped() && canCarry()`) is a three-way condition. Its comment explains why the *other* branch exists, not this one.
      - `attempt` registers `pending.wait` before `transport.write`, and checks abort twice (in `refusal` and again in `attempt`). The comment at line 325 resolved the second check.
      - The `pastDrain` flag reaches here from `IncomingRequests` through `Session.incomingFor`. It is action at a distance.
   3. **`src/pdu.ts:84-136`: `resolveShortMessage` / `resolveBody` (plus `readParams` at 249).**
      - The `CodingSource` return value decides whether an encoded `message_payload` may overwrite `data_coding`. Without the domain, I had to derive why an empty `short_message` hands `data_coding` to the TLV. The `CodingSource` doc comment half-resolves it.
      - `readParams` passes `paramNumber(params.sm_length, 0)` as the length to *every* field's `read`. It only works because `sm_length` precedes `short_message` in wire order. That is an order dependence stated only as the general "parameter order is wire order" warning, not at the call.
   4. **`src/handled-messages.ts:359-423` and `src/expiring-groups.ts:442-554`: `HandledMessages.offer` / `run` / `refuses`, and `ExpiringGroups`.**
      - `ExpiringGroups`'s contract is inverted: it "enforces neither max nor timeout itself", only `weigh()` evicts, `onSweep` must call `takeExpired()`, and `takeOldest` goes through `delete` (which stops the timer) while `takeExpired` goes through `remove`. Each owner (Reassembler, DlrMerger, HandledMessages) re-implements the policy.
      - In `HandledMessages`, the `answered` flag is set by a closure threaded into `createSms`. `run` uses an identity check (`running.get(key) !== handled`) to detect that `clear`/`sweep` got there first. `refuses()` has hysteresis state (`atBound`) and calls `sweep()` as a side effect.
      - The class doc comment resolved the intent. The mechanics took rereads.
   5. **`src/incoming-requests.ts:105-260` together with `src/server.ts:542-567`: `IncomingRequests.handle` / `route` / `onMessage` / `offer`, and `handleRequest`.**
      - Searching for where a bind is accepted, I found `IncomingRequests.unhandled` answering binds with `ESME_RALYBND`. The real bind handling is in server.ts, injected as `onRequest`, so the "application hook" slot is also the server's own bind handler.
      - The charter's Decisions index says this ("composes the application's onRequest after its own bind handling"), but the reader gets there only after a wrong turn.
      - Link generation is checked twice by different mechanisms: inline in `handle`, and as a `lostLink` closure in `offer`.
      - `carriedAs`/`standsInFor` rewrites `data_sm` depending on `linkEnd`, a mutable public field set after construction (`session.linkEnd = 'smsc'` in server.ts:586).
   6. **`src/reassembly.ts:425-444`: `Reassembler.trim`.**
      - `weigh()` returns evicted groups, possibly including the current one. `answered = parts.size - 1` excludes the refused segment from the loss count.
      - `collect` only weighs incomplete groups; the completing segment is never weighed. I had to confirm that is intended.
      - The comments at 361 and 437 resolved it, after two reads.
   7. **`src/dlr.ts:342-424`: `messageType` / `receiptStatus` / `dlrFromPdu`.**
      - Four message types, with `'unmarked'` meaning "maybe a receipt if the body parses to both an id and a state". Status comes from TLV, then body, then UNKNOWN, and `statusId` and `statusMsg` can disagree by design.
      - This is domain-heavy but well commented with spec sections. README's "Delivery receipts" section closed the gap.
   8. **`src/defs/encodings.ts:302-341`: `messageClassOf` / `messageClassEncoding` / `encodingByDataCoding`.**
      - Bit-twiddling over GSM 03.38 coding groups that I had no context for. The comments give the bit positions, so it resolves with care.
      - The GSM codec object is named `ascii` (line 196), which is a lying name for GSM 03.38.

2. **The unit I would least want to modify: the Session link lifecycle (`Session.drain` / `finish` / `linkLost` / `comeBackUp`) together with `LinkLife`.**
   - Correctness depends on call order across three classes. `stop()` must reach the loop before the first await; client.ts:239 says so from *another file*.
   - `close` and `disconnected` must stay exclusive, and `end()` must release waiters exactly once.
   - Any change risks a hung `close()` or a double `close` event, and nothing local tells you which invariant you just broke.

3. **Expected hard, found easy.**
   - The wire codec in `defs/types.ts`: repetitive, every read is range-checked, and `Result` is uniform.
   - `PduFramer`: short, with the quadratic concern stated.
   - The `send-sms.ts` check pipeline: linear and flat, each refusal named.
   - `DlrMerger` severity ranking: one comment explains why wire values can't be compared.
   - `bind-direction.ts`: `standsInFor`/`bindCarries` are tiny and explained.
   - The UDH walk in `udh.ts`.
   - The no-throw discipline made every call site read the same way.

4. **Prose debt.**
   - **Needed, and where I found it:**
     - What ESME and SMSC are. Only inferable from `LinkEnd`'s comment and README.
     - What "answered on arrival" means. README "Server in depth", roughly a 400-line scroll.
     - Why `data_sm` flips direction. The comment in bind-direction.ts is sufficient.
     - How the server's bind handling composes with `onRequest`. Only in the AGENTS.md Decisions index, as one line whose reasoning is in docs/decisions.md, which I was barred from.
     - The 134/153 segment budget. Covered both inline (message.ts:364) and in AGENTS, so it was cheap.
     - Many AGENTS decision lines are pointers into a file I couldn't open. For the lifecycle ("A deliberate shutdown drains; an unusable link and an abort do not"), the one-liner was the only statement of the rule the code implements.
     - The AGENTS architecture map was accurate and was the cheapest, most useful prose.
   - **Told me nothing the code didn't already say:**
     - `Session.send`'s "Sends a request and resolves with the peer's response."
     - README's "Everything exported" table, which duplicates `index.ts`.
     - The `defaults.ts` preamble.
     - AGENTS "Conventions", about 30 lines on test fixtures and teardown, which are irrelevant to reading `src/`.
     - The repeated "Injected so expiry can be exercised without a wall clock" on four options types.
   - **Minor drift:** README types `onSms` as `(sms) => Promise<void> | void`; the code declares `(sms) => unknown`.

5. **Scores.** Intrinsic difficulty is high: a stateful protocol session with reconnect, drain, windowing and reassembly. It gets no bonus.
   - **Navigation 8.** Above 7 "the layout answers where does this live": `src/` is flat, file names match contents, and the AGENTS map is accurate. It stops short of 9 because server bind handling lives behind the `onRequest` slot, which cost one wrong turn.
   - **Locality 6.** Between 5 and 7: most units stand alone. Link liveness is split across `LinkLife.phase`, `stopped`, `ReconnectLoop.halted`, `canCarry()`'s socket check and generation counters. Changing shutdown means holding session.ts, link-life.ts, outgoing-requests.ts and client.ts at once, and `linkEnd` is mutated after construction.
   - **Shape 7.** At "predictable": classes are small and fan-out is bounded per level. A few names lie: `ascii` for the GSM codec, `HandledMessages` for messages still being handled, `retrying()` used as "not closed", and `settle` meaning different things in five classes.
   - **Self-sufficiency 7.** At 7: comments carry the why with spec section references at the hard points (receipts, UDH, data_coding bits). What is missing is the lifecycle invariant and the bind composition, which exist only as index lines pointing at a decisions file.
   - **Overall 6.** Capped at loc+1 = 7. I place it at 6 because the hardest part, the session lifecycle, is hard both because the problem is hard and because its state is spread across files. It is neither localized nor marked as one place.

SCORES nav=8 loc=6 shape=7 self=7 overall=6

## Draft D, senior seat

1. **Hardest places, hardest first**

   1. **The link lifecycle across four owners.** `src/session.ts:265-362` (`drain`, `finish`, `linkLost`, `dropLink`, `comeBackUp`), `src/link-life.ts:31` (`LinkLife`), `src/reconnect-loop.ts` (`stop`/`halted`) and `src/outgoing-requests.ts:120` (`refusal`, which uses `canCarry()` = `link.isUp() && !sock.destroyed`).
      - There are three "stopped" notions: `LinkLife.stopped`, `ReconnectLoop.halted`, and `phase === 'ended'`, which also sets `stopped`. `drain()` and `finish()` each call `link.stop()` and `reconnectLoop?.stop()`, so I had to hold the order of the calls to see which one decides the `close` event versus `disconnected`.
      - `link-life.ts:38` starts `phase` at `'up'`, although `'binding'` exists. The first link therefore reports `isUp()` before any bind, and the charter's "a bind is what makes it one" holds only for reconnected links. I worked this out myself; nothing in the code says so. The code mostly explains itself, but that one point stayed opaque.
   2. **Who answers a failed handler.** `src/handled-messages.ts:92-140` (`offer`, `run`), together with `src/sms.ts:83-157` (`createSms`, `sendResp`, `answeredOnArrival`) and `src/incoming-requests.ts:252` (`offer`).
      - An `answered` flag is set through a callback that `offer` builds around a `handled` const, which that same closure refers to. `SmsRoute = Omit<SmsHandlers,'answered'>` and a mutable `Answer` object add further state, and the `lostLink` generation closure is built in yet another class.
      - When a multipart handler fails, `run()` calls `sendResp({status: retryStatus})`. That returns an `err` from `answeredOnArrival`, and the `err` is discarded. That is how "its answer stands" comes out right, and nothing says so. README's "A handler that fails" bullet resolved it.
   3. **Reassembly eviction.** `src/reassembly.ts:110` (`collect`) and `:187` (`trim`), with `src/expiring-groups.ts:70` (`weigh`).
      - `weigh()` can evict the group that is being weighed, so `trim` counts it as `parts.size - 1` answered. The `full` / `unplaceable` refusals map to three statuses in `refusedSegmentStatus`.
      - `ExpiringGroups` enforces its limits unevenly: only `weigh` evicts, while `max` and `timeout` fall to the owners, and I had to find that in its class docstring. The inline comments resolved it, but it took a reread.
   4. **Building and reading the message body.** `src/pdu.ts:84-136` (`resolveShortMessage`, `resolveBody`) and `:249` (`readParams`).
      - On the write side, `CodingSource` decides which of `short_message` and `message_payload` may overwrite `data_coding`. An empty buffer counts as `'message_payload'`. I had to hold four branches at once.
      - On the read side, `readParams` passes `sm_length` as the `length` argument to every wire type's `read`. The same parameter means the TLV length in `defs/types.ts`. Only the `commands.ts` comment on wire order hints at this coupling.
   5. **data_coding bit logic.** `src/defs/encodings.ts:159-190` (`messageClassEncoding`, `encodingByDataCoding`).
      - It is dense bit-twiddling with no context, and a `//` comment sits above a separate `/** */` block, so I could not tell which of the two it belonged to.
      - Some names are wrong. `'LATIN1'` is returned for 8-bit binary. The GSM codec is named `ascii` (`:45`).
      - The docblocks resolved most of it. The class-group comment stayed only half clear.
   6. **`DlrMerger`'s two stores.** `src/dlr-merger.ts:68`, with `spend` at `:166` and `open` at `:150`. Two `ExpiringGroups` (`groups` and `spent`) are both mutated by `spend()`. `open()` checks both, and `dropOldest` spends. The class docstring explained the "merged at most once" rule. I still had to trace the steps by hand.
   7. **Retrying the first bind.** `src/client.ts:218-320` (`bindOn`, `initialAttempts`, `keepTrying`). This is a second `ReconnectLoop` outside `Session`, with a fresh session per attempt and a `lastErr` closure. Correctness depends on the order in which abort listeners are added and removed, and on the comment "close() must reach the loop's stop() before its first await". The comments resolved it.

2. **The unit I would least want to modify:** `LinkLife` (`src/link-life.ts`). `Session`, `OutgoingRequests` (`isUp`, `awaitsNextLink`, `refusal`, `hold`) and `IncomingRequests` (`generation`) all read its phase. Its `stopped` flag duplicates the reconnect loop's, and its initial `'up'` is an unstated exception to its own `binding` rule. A change there reaches the drain, the queued sends and response correlation, and no single file shows all of that.

3. **Expected to be hard, found easy:**
   - The codec: `defs/types.ts` is long but uniform, and every read is range-checked the same way.
   - `PduFramer`, `ReconnectLoop` and `PendingRequests`.
   - The typing of `TlvInputs` and `Tlvs`.
   - `splitMessage` and the budget per segment.
   - Navigation overall: the charter's one-line-per-file map matched the tree exactly.

4. **Prose debt**
   - **Needed, and what it cost to find:**
     - README "Receiving in depth" and "Shutdown", to learn the half-bound hysteresis, the five-minute handler cutoff, and what happens when a handler fails after answering. Finding them was cheap, but they sit in a user document, not beside `HandledMessages`.
     - The rationale for the link-life decisions. AGENTS.md only indexes it ("One owner decides whether a link can carry a request…") and I was not allowed to open `docs/decisions.md`, so the initial-`'up'` question stayed open.
     - I opened no tests.
   - **Told me nothing the code did not already say:**
     - `session.ts:203` "Sends a request and resolves with the peer's response".
     - The getter docstrings on `boundAs` and `peerInterfaceVersion`.
     - `UnansweredError`'s docstring, which restates its message.
     - `retryStatus`'s docstring.
     - The idle-timeout rationale, written twice (`defaults.ts:13` and `client.ts:193`).
     - `checkSessionOptions`'s docstring describes one case, `maxOutstanding: 0`, not the function, which misleads slightly.
     - AGENTS.md's 0.4.0 defect table and its long test-fixture paragraph cost reading time and did not help with `src/`.
   - **Small duplication noticed:** `collectSent` in `send-sms.ts` and `collectReceipt` in `sms.ts`, and `quoted()` in both `session-options.ts` and `bind-direction.ts`.

5. **Scores**

   | Dimension | Score | Anchor and cause |
   | --- | --- | --- |
   | Navigation | 8 | Between 7 and 9. The Architecture map and truthful file names took me from symptom to file first try every time. The lifecycle behaviour spread over `Session`, `LinkLife` and `ReconnectLoop` is what keeps it from 9. |
   | Locality | 6 | Between 5 and 7. Most collaborators are standalone, with injected `now` and dependencies. But whether a link can carry a request, is stopped, or has ended is split across `LinkLife`, `ReconnectLoop`, `OutgoingRequests.canCarry` and order-dependent calls in `Session`, and the handled-message `answered` state runs through closures in three files. |
   | Shape | 7 | Predictable. Fan-out is bounded per level and nearly every name tells the truth. The exceptions are `ascii` for GSM, `LATIN1` standing for binary, and `isUp()` being true before the first bind. |
   | Self-sufficiency | 7 | Predictable. Inline comments carry most of the "why" (SMPP section references, peer quirks). The handler bound and failure semantics needed README, and the reasoning behind the link-life decisions sits in a document I could not open. |
   | Overall | 7 | Predictable, within the cap of lowest dimension plus one. The hard corners are few and I know which to fear, but the lifecycle corner is spread across four files instead of sitting in one marked place. |

   The problem is intrinsically hard: SMPP session semantics, reconnecting with no resends, a draining shutdown, and reassembly under memory bounds. The scores give no bonus for that.

SCORES nav=8 loc=6 shape=7 self=7 overall=7

## Draft D, architect seat

**Comprehension panel report: Architect, inherited (draft-d)**

**Order note:** I read AGENTS.md right after README and the tree, before I had written the map down. Its architecture listing matched the map below and changed nothing in it. I opened no test files.

### 1. Map (README + tree only, verbatim)

Top-level areas I expected in `src/`:
- **A. Entry points:** `index.ts` for the public surface, `client.ts` for connect and bind with reconnect, `server.ts` for the listener, auth and close.
- **B. Session core:** `session.ts` as the hub. `session-options.ts` and `defaults.ts` for options. `bind-direction.ts` for which commands a bind type carries.
- **C. Link lifecycle:** `link-life.ts` (up, down or ended?), `link-timers.ts` (enquire_link and idle), `reconnect-loop.ts` (backoff), `pdu-transport.ts` (socket to PDUs).
- **D. Outbound:** `send-sms.ts` (split and submit), `outgoing-requests.ts` (the request path), `pending-requests.ts` (seqNr correlation), `send-window.ts` (maxOutstanding), `unanswered-error.ts`.
- **E. Inbound:** `incoming-requests.ts` (dispatch), `sms.ts` (the onSms handle), `handled-messages.ts` (probably the "held while the handler runs" bound), `reassembly.ts`, `concat.ts`, `udh.ts`, `message-body.ts`.
- **F. Receipts:** `dlr.ts` (parse), `dlr-merger.ts` (messageDlr), `sms-id.ts` (hex/decimal and `<base>-<n>`).
- **G. Codec:** `pdu.ts`, `pdu-framer.ts`, `pdu-refusal.ts` (PduRefusedError), `retained-pdu.ts` (?), `defs/*` (spec tables).
- **H. Text:** `message.ts` (encode, split, smppTime) and `defs/encodings.ts`.
- **I. Utilities:** `result.ts`, `error-from.ts`, `log.ts`, `uuid.ts`, `idle-waiters.ts` (?), `expiring-groups.ts` (?).

Names that did not give their purpose:
- `idle-waiters`: idle peer or idle count?
- `retained-pdu`
- `expiring-groups`: groups of what?
- `handled-messages`: reads as "already handled".
- `error-from`
- `defaults` vs `session-options`

README features I could not place, or that were missing:
- Goal 9's store is absent, as the README says.
- smppTime and smppDate: presumably `message.ts`.
- At the repo root, `MIGRATION-NOTES.md` and `DESIGN.md` beside `MIGRATION.md` and `docs/decisions.md`: I cannot tell their purpose apart from the others.

**Where the map was wrong, and what each correction cost:**
- **`handled-messages.ts` (medium cost, and it is the crux of the 3am question).** I guessed "held until `sendResp()`". It actually holds a message until the **handler's promise settles**. `answered` is recorded only to decide the retry refusal.
- **`link-life.ts` (medium).** It is not only a state flag. It is also the queue where requests wait for the next link, with two orthogonal state variables, `phase` and `stopped`.
- **`expiring-groups.ts` (medium).** It is a shared TTL store whose contract is "enforces neither max nor timeout itself" (`expiring-groups.ts:18`). Each of its three owners re-implements the policy differently. `HandledMessages` uses it for running handlers, which are not groups. `DlrMerger` uses a second instance as a "spent" set.
- **Cheap corrections:**
  - `session-options.ts` also holds `SessionEvents` and all option validation.
  - `bind-direction.ts` also holds bind-record validation (`checkedBind`) and `undeclaredInterfaceVersion`.
  - `reassembly.ts` holds `decodeSegments`, which `sms.ts` uses.
  - `idle-waiters.ts` is "wait until a count reaches 0".
  - `retained-pdu.ts` copies PDUs off the wire and weighs them.

### 2. Fan-out by level
- **L0, repo root:** 22 entries, 8 of them prose documents. Two documents I could not tell apart by name.
- **L1, `src/`: 36 files plus `defs/`, all flat. This is the worst level.** Only names and the AGENTS listing group them into the 9 areas above. Nine is bounded; 37 is not, and the directory gives no help.
- **L2, `defs/`:** 7 files, bounded and clear.
- **L3, units:**
  - `Session` wires 9 collaborators and has about 15 methods.
  - `IncomingRequests` owns 3 things and reaches back into `Session`.
  - `OutgoingRequests` owns 3.
  - `LinkLife` has 12 methods over 2 state variables. By method count it is the densest unit.

### 3. Names
**One name over several concepts:**
- **idle** means four things:
  - `IdleWaiters`: a count falls to 0.
  - The `LinkTimers` idle timeout: a silent peer.
  - `ExpiringGroups.idle()`: stop the sweeper.
  - `SendWindow.idle()`: the drain.
- **refusal** means four things:
  - `pdu-refusal`: an unreadable PDU.
  - `LinkLife.refusal()`: the session is over.
  - `OutgoingRequests.refusal()`: a request cannot go out.
  - The reassembly `Refusal`: `'full' | 'unplaceable'`.
- **settle** covers waiters, pending requests, `IdleWaiters.settle` and `HandledMessages.settle()`, which means "wake the drain if empty".
- **Shutdown verbs:** `stop`, `end`, `finish`, `drop`, `dropLink`, `linkLost`, `halted`, `isOver`, `isStopped`. `link.stop()` refuses new work while `reconnectLoop.stop()` halts timers: same verb, different meanings.

**One concept with several names:**
- "Answered": `Answer.done` (`sms.ts:81`), `Handled.answered` (`handled-messages.ts`), `answeredAs` and `answeredOnArrival`.
- Writing a response: `answer()`, `sendReturn()`, `sendResp()`.
- The reassembly octet cap: option `maxOctets` vs `defaults.maxReassemblyOctets`. The option name does not say "reassembly", yet a sibling cap exists (`maxHandledOctets`).
- The server's idle timeout: the literal `defaults.idleTimeout` 40 000 vs the client's derived `2 × enquireLinkInterval`.
- Two date formatters, `smppDate` and `smppTime.encode`, in `message.ts`, with duplicated pad chains.

**Misleading:**
- `HandledMessages` means "being handled". The README calls them "messages being handled".
- `ExpiringGroups` holds running handlers, which are not groups.
- `bind-direction.ts` holds more than direction.

**Copies:**
- `quoted()` appears twice (`session-options.ts:78`, `bind-direction.ts:54`).
- `collectSent` (`send-sms.ts:274`) and `collectReceipt` (`sms.ts:183`) are near-twins.
- An inline `thrown instanceof Error ? … : new Error(String(thrown))` appears three times (`client.ts:89`, `reconnect-loop.ts:80`, `reconnect-loop.ts:136`) instead of `errorFrom()`.

### 4. What I would restructure, ranked
1. **Group `src/` into about 6 folders:** link, outbound, inbound, receipts, codec, text. The AGENTS listing already draws those lines, so this only moves the map from a document into the layout.
2. **Give the shutdown/link vocabulary one owner.**
   - Collapse `LinkLife.phase` and `stopped` into one state enum.
   - Rename so that "stop" means one thing everywhere.
   - Move `OutgoingRequests.refusal`'s `pastDrain && isStopped && canCarry` condition (`outgoing-requests.ts:129`) behind one `LinkLife` predicate.
3. **Make `ExpiringGroups` enforce its own policy,** or split it into a TTL store and a set. Today three owners re-implement "full", weight and sweep, and its sweeper interval equals its timeout. So expiry is lazy by up to 2× (`expiring-groups.ts:60`): the README's "five minutes" handler cap is really 5–10 minutes when no traffic arrives. That is a plausible claim drift; I derived it from the code and have not verified it.
4. **Merge the "answered" state into one place,** so `sms.ts` and `HandledMessages` stop tracking the same fact.
5. **Use `errorFrom()` everywhere.**
   - `reconnect-loop.ts:80` runs `String(thrown)` inside the `.catch` that is meant to contain an application throw. `errorFrom`'s own comment says `String()` can throw.
   - If it does, `void this.run()` rejects unhandled and `attempting` stays `true`, which wedges the loop. The trigger is a null-prototype object thrown from an application-supplied `ReconnectOptions.connect` or `onConnected`, reachable because `Session` is publicly constructible.
   - I call this plausible, not verified.

**What the structure gets right:**
- Files are small (all under 420 lines).
- Every file name maps to one noun that also appears in `Session`'s fields.
- `Session` reads as a table of contents.
- Imports point one way.
- Hard-rule-1 result types are uniform.
- Comments carry the WHY at the line: spec section numbers, peer quirks, past defects.
- `defs/` is clean.
- `PduFramer`, `PendingRequests`, `SendWindow` and `ReconnectLoop` each fit in the head alone.

### 5. The 3am question
**Symptom:** during a graceful shutdown the session hangs until `shutdownTimeout`, although the application called `sendResp()` on every message.

**Path, cold, about 2–3 minutes:** `Session.close` → `drain` (`session.ts:265`) → `this.incoming.drain(...)` (`session.ts:274`) → `IncomingRequests.drain` (`incoming-requests.ts:163`) → `HandledMessages.idle` (`handled-messages.ts:111`).

**The unit is `HandledMessages.run` (`handled-messages.ts:125`).** The entry is deleted at `:138` only after `await this.handle()` returns. `sendResp()` only flips `handled.answered`, and the drain never reads it.

**So the peer's handler has not returned.** The likely cause is that it is awaiting `sms.sendDlr()`. That call waits for every `deliver_sm_resp`, up to `responseTimeout`, which defaults to 30 s, longer than the 5 s shutdown. It can also wait without bound behind a full send window, because `sendDlr` passes no signal.

This is designed behaviour: the `OnSms` type doc, README lines 108 and 389, and the AGENTS decision all say it. The fix is on the caller's side (return the handler, or fire-and-forget the receipt). The code states this at the type (`session-options.ts:39`), so no document is needed.

**Where it rots first:**
- The link/shutdown triangle: `Session.drain`/`finish`/`linkLost`/`dropLink`/`comeBackUp` plus `LinkLife` plus `OutgoingRequests.refusal`. Three units read `LinkLife` state. Correctness depends on call order: `link.stop()` before `canCarry()`, `drop()` before `end()`. `IncomingRequests` also snapshots `link.generation()`.
- Next, `ExpiringGroups` and its three divergent owners.

**Where the next two features land:**
- **Goal 9's store** would have to thread an interface through `Session` → `IncomingRequests` → `Reassembler`/`HandledMessages`/`DlrMerger`, which is every `ExpiringGroups` owner. That is the costliest seam in the code base.
- **A per-PDU rate-limit hook (goal 7)** lands cleanly in `OutgoingRequests.request` beside `SendWindow.acquire`.

### 6. Hardest places, ranked
1. `session.ts:265-362`: `drain`, `finish`, `linkLost`, `dropLink`, `comeBackUp`. Order-dependent shutdown across 4 collaborators.
2. `link-life.ts:31` `LinkLife` as a whole: `phase` × `stopped`, and 7 predicates with overlapping meanings.
3. `outgoing-requests.ts:74-134`, `request` and `refusal`: the link-wait/window retry loop and the `pastDrain` exemption.
4. `handled-messages.ts:67-138`, `refuses`/`offer`/`run`: hysteresis, a hidden sweeper timer, and the answered flag written from `sms.ts`.
5. `expiring-groups.ts` `weigh` together with `reassembly.ts:187` `trim`: eviction can take the current key.
6. `pdu.ts:84-136`, `resolveShortMessage` and `resolveBody`: the `CodingSource` rules.
7. `incoming-requests.ts:218-260`, `onMessage` and `offer`: the bound check, reassembly, answer on arrival, and generation capture.
8. `dlr.ts:216` `dlrFromPdu`: the `messageType`/`receiptStatus` precedence.

**The unit I would least want to modify is `LinkLife`.** Everything that decides whether a request may go out reads it, and its meaning is spread over 7 predicates.

**Intrinsic difficulty:** high. It is an SMPP session layer with reconnect, a send window, reassembly, receipt merging and drain semantics, and it earns no bonus for that.

### 7. Scores
- **Navigation 7:** "Predictable". The file names plus `Session`'s field list got me from symptom to unit in 3 hops. The flat 37-file `src/` and the misleading name `HandledMessages` keep it below 9.
- **Locality 6:** between "honest middle" and "predictable". `LinkLife` state is read by `Session`, `OutgoingRequests` and `IncomingRequests`, and shutdown correctness depends on call order. `ExpiringGroups` pushes its own policy onto three owners.
- **Shape 6:** between "honest middle" and "predictable". Units are small and mostly named truthfully. But L1 has 37 ungrouped entries, and "idle", "refusal", "settle" and "stop" are each overloaded.
- **Self-sufficiency 7:** "Predictable". Comments at each unit state its invariants and the spec section behind them, and the 3am answer is readable at the `OnSms` type with no document open. A reader still needs the AGENTS listing to see the area grouping that the layout does not show.
- **Overall 6:** capped by locality and shape at 6. A cold senior is productive within a week on everything except the link/shutdown triangle.

SCORES nav=7 loc=6 shape=6 self=7 overall=6
