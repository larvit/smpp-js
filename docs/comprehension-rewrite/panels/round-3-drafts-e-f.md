# Round 3: drafts E and F

## Draft E, junior seat

1. **Hardest places, hardest first**

   1. **`src/session-life.ts:175` `SessionLife.attempt()`, with `enter()` at `:115` and `linkLost()` at `:109`.** The async reconnect continuation re-enters the state machine after two awaits. It snapshots `this.links` and later compares it, and it reads state through `is()` only to stop TypeScript narrowing. The step to `bound` is not in this file: it goes `rebind` → `client.ts` `bind()` → `Session.bound()` → `life.bound()`, three files away. There is also hidden re-entrancy. `effects.linkDown()` calls `sock.destroy()`, which fires the transport's `onClose` → `life.linkLost()`. That call is harmless only because `attached()` is already false. The ASCII diagram at `:8-24` and the comment "a transition from any other state is ignored" resolved most of it. Why `links` could change during `rebind` stayed opaque.
   2. **`src/outgoing-requests.ts:97` `request()`, `sendOnce()` at `:116` and `attempt()` at `:162`.** There is a `for(;;)` retry around three nested waits: link, window slot, response. Each has its own deadline or timeout semantics, and `written` plus `state() !== 'down'` decide whether to loop. The `misuse()` check runs here and again in `Session.send()` (`session.ts:180`), and the reason for the duplicate is a riddle comment ("named as one ahead of the drain"). The JSDoc on `request()` and the `UnansweredError` naming resolved the intent. I had to read `README` "Sends and the link" to trust it.
   3. **`src/handled-messages.ts:61` `refuses()` and `:120` `run()`.** `refuses()` looks like a predicate but sweeps, logs, and flips `atBound` hysteresis. `run()` answers the peer after the handler, and the answer depends on whether `sms.answered` was flipped by a closure inside `sms.ts`. It then removes the entry only if `running.get(key) === sms`, because a sweep may already have dropped it while the handler keeps running. `ExpiringGroups` gets `max` here but, by its own doc, does not enforce it, so I had to go and read `expiring-groups.ts` to know who does.
   4. **`src/reassembly.ts:186` `trim()`, with `ExpiringGroups.weigh()` at `src/expiring-groups.ts:70`.** `weigh()` evicts the oldest groups and may return the current key itself. Then `answered = parts.size - 1` subtracts the just-arrived segment, because that one gets a `full` refusal and the peer keeps it. Holding "set never evicts, weigh does, owners check full" across two files cost two rereads. The inline comments resolved it.
   5. **`src/sms.ts:82` `createSms()` and `:126` `sendResp()`.** A mutable `answer` record is captured in a closure and exposed through getters. `link` is the socket at arrival, compared by `destroyed` rather than against `session.sock`. `answeredAs` means "multipart, already answered on arrival". I only understood why `sendResp()` on a multipart message is a no-op after reading README "Server in depth" (answered on arrival). The code alone did not tell me.
   6. **`src/pdu.ts:84` `resolveShortMessage()` and `:113` `resolveBody()`.** The `CodingSource` idea is hard for someone without SMPP: which of `short_message` and `message_payload` gets to set `data_coding`, and when an empty buffer counts as "payload". Also, `readOptionalParams()` at `:267` retries parsing with one skipped NULL. The comments are accurate but assume the domain. README "Building" and the SMPP terms table were needed.
   7. **`src/defs/encodings.ts:152-191` `messageClassOf()`, `messageClassEncoding()`, `encodingByDataCoding()`.** Bit masks (`0x80`, `0x10`, `0xF0`, `>> 2 & 0x03`) against GSM 03.38 coding groups I have never seen. The comments cite spec sections I cannot open. This stayed opaque. I trust it only because the tests presumably pin it; I did not open them.
   8. **`src/client.ts:240` `retryUntilBound()` and `:278` `keepTrying()`.** This is a second backoff loop, separate from `SessionLife`'s. Its `settle` callback is called on every failure and does not settle anything; it only records `lastErr`. The name misled me until I read the callback body at `:290`. AGENTS' architecture line ("the first-connect retry of reconnect.fromStart") told me why it exists.

2. **The unit I would least want to modify:** `SessionLife.enter()` / `attempt()` (`src/session-life.ts:115-203`). Every lifecycle effect fans out from it through `LifeEffects` closures defined in `session.ts:260`. Those closures call back into the transport, whose socket events call `life.linkLost()` again. Correctness rests on "ignored from any other state" and on the ordering of effects before emit. I could not predict what a new transition would re-trigger without running it.

3. **Expected hard, found easy:**
   - `PduFramer`: small, one job, and the quadratic-avoidance comment explains the only trick.
   - The wire-type table in `defs/commands.ts`, where the wire-order warning sits right at the table.
   - The result pattern and "nothing throws": consistent everywhere, so no surprises.
   - `defaults.ts`: one place, grouped.
   - `sms-id.ts`, `concat.ts`, `message-body.ts`, `log.ts`, `pdu-refusal.ts`: each read cold in one pass.
   - `send-sms.ts`: long but linear, a chain of `check*` functions.
   - The AGENTS architecture map, which got me to the right file first time for every question I had.

4. **Prose debt**
   - **Documentation I needed:**
     - README "SMPP terms" table: essential and cheap to find, linked from the table of contents.
     - README "Server in depth" and "Receiving in depth", for answered-on-arrival and the handled-message bound. The rules behind `sms.ts` and `handled-messages.ts` live there, not in the code.
     - AGENTS architecture list: essential for navigation.
     - The AGENTS decisions index lines are cryptic without `docs/decisions.md`, which I was not allowed to open (for example "A report is final unless its `esm_class` or its state says otherwise").
     - Spec knowledge (`esm_class` bits, `data_coding` groups) is cited by section number and never explained. That cost the most and was never repaid.
   - **Prose that told me nothing the code did not already say:**
     - The duplicated deliver JSDoc in `outgoing-requests.ts:84` and `pending-requests.ts:57`.
     - `/** A socket is on the link. */` on `attached()`.
     - The AGENTS "Defects found in 0.4.0" table, which is history and not a guide to the current code.
     - The AGENTS test conventions, which are irrelevant to reading `src/`.
     - A different cost: many comments are compressed to riddles and needed several reads each. Examples are "Announced when the wait is over rather than when it starts: a cancelled one never happened." (`session-life.ts:160`) and "A misuse is named as one ahead of the drain, rather than blamed on the shutdown."

5. **Scores**
   - **Navigation 7:** at the "Predictable" anchor. The AGENTS file map and honest file names (`pdu-framer`, `link-timers`, `sms-id`) took me symptom → file first try. It stops short of 9 because reconnect lives in two places (`session-life.ts` and the separate `client.ts` retry loop).
   - **Locality 5:** at the "Honest middle" anchor. Collaborators are wired by closures back into `Session` (`LifeEffects`, `PduTransport` callbacks, `IncomingRequests` calling `session.emit`, `.sock` and `.close`). The `Sms` answer record is mutated from two modules. Safe changes in `SessionLife` and `HandledMessages` need the whole session held in your head.
   - **Shape 6:** between 5 and 7. Fan-out per level is bounded and the files are small. Names overload or lie, though:
     - `settle` means four different things (`IdleWaiters`, `PendingRequests`, `SendWindow`, the `client.ts` callback that settles nothing).
     - `handlers` in `IncomingRequests` means `{answer, send}`, not `onSms`.
     - `refuses()` and `closing()` read as predicates but mutate.
     - `SessionLife.carries()` is dead: unused in `src/`, duplicated by the switch in `OutgoingRequests.waitForLink()`.
   - **Self-sufficiency 5:** at the "Honest middle" anchor. The generic parts (framer, codec types, results, timers) stand alone. The session semantics (answered-on-arrival, the handled-message bound) and all the `data_coding`/`esm_class` bit logic needed README sections or the spec open beside the code.
   - **Overall 5:** as someone new to the domain, I would take an area in a day or two, with rereads and some wrong turns. The problem's intrinsic difficulty is genuinely high (a protocol state machine, reassembly, and receipt correlation over a flaky link), and it gets no bonus here.

SCORES nav=7 loc=5 shape=6 self=5 overall=5

## Draft E, mid seat

1. **Hardest places, hardest first**

   1. **The answer to an inbound message**, `incoming-requests.ts:218` (`IncomingRequests.onMessage`), `handled-messages.ts:120` (`HandledMessages.run`) and `sms.ts:126` (`sendResp`), with `sms.ts:82` (`createSms`) holding the `Answer` record.
      - Whether the peer has been answered, and under which id, is decided in three places:
        - `onMessage` answers multipart segments one by one on arrival and passes `answeredAs`.
        - `createSms` turns `answeredAs` into a pre-set `status: 'ESME_ROK'`.
        - `run` answers after the handler only when `!sms.answered`, choosing the retry status if the handler failed.
      - "Which link" is carried as a `Socket` identity that is compared through `.destroyed` in two places (`IncomingRequests.handle` and `sendResp`).
      - To reason about "handler throws after a multipart message" I had to keep all three files in my head. The `Sms` type docs and the README section "Server in depth" resolved it. It is followable but not local.
   2. **`ExpiringGroups` and the classes built on it**, `expiring-groups.ts:19`, with `reassembly.ts:187` (`Reassembler.trim`) and `dlr-merger.ts:105/150/166` (`collect`, `open`, `spend`).
      - The store refuses to enforce its own `max` and `timeout` ("owners check full and call takeExpired(); only weigh() evicts"). So each of the three owners re-implements the capping itself (`open` → `dropOldest`, `sweep` before `collect`).
      - `weigh()` can evict the very key being weighed. `trim` then does `answered = parts.size - 1` for that case, and I needed two reads to see why.
      - `DlrMerger` runs a second `ExpiringGroups<true>` (`spent`) as a tombstone set, with `spend()` writing to both stores.
      - The doc comments stop you misusing the store, but understanding any one owner means holding the store's partial contract.
   3. **`resolveShortMessage` / `resolveBody`**, `pdu.ts:84` and `pdu.ts:113`.
      - `CodingSource` decides whether `short_message` or `message_payload` may set `data_coding`. That depends on Buffer vs string vs empty, and on whether the command's table has a `short_message` at all.
      - I had to hold four or five branches at once, and `data_coding` gets rewritten in two different spots.
      - The type comment on `CodingSource` helped. The rule behind it ("a string body is written in the alphabet its own data_coding names") is only a title in the AGENTS index.
   4. **The retry loop in `OutgoingRequests.request` / `sendOnce`**, `outgoing-requests.ts:97` and `:116`.
      - `sendOnce` returns `undefined` to mean "loop again". Whether to loop depends on `attempt.written` and on a live read of `state() !== 'down'` after two awaits.
      - With `LinkWaiters`, `SendWindow` and `PendingRequests` underneath, a send passes through four waits with three different abort and timeout rules.
      - The doc comments on `request` and `Attempt.written` resolved it, as did the README bullets under "Sends and the link".
   5. **`SessionLife.enter` / `attempt`**, `session-life.ts:115` and `:175`.
      - The ASCII state diagram is very good. What cost me was `attempt()`: it re-checks `is('down')` after `connect`, then `this.links !== link || !is('connected')` after `rebind`.
      - `rebind` calls `Session.bound()`, which calls `life.bound()` → `enter('bound')`. That is a re-entrant path back into the machine from inside an await.
      - The comment "the one continuation that re-enters the machine" marks it, and the diagram resolved it.
   6. **`Session.unbind` / `drain`**, `session.ts:218` and `:317`.
      - `life.closing()` is a query-named method that performs the transition.
      - `closedOnUnbind = wasOpen && !this.life.attached()` infers that the peer dropped the link in answer to our unbind.
      - The return value orders two errors with different priorities.
      - The doc comment helped. The mutating `closing()` still surprised me.
   7. **The two reconnect loops**, `client.ts:240` (`retryUntilBound`) and `client.ts:278` (`keepTrying`).
      - AGENTS says "the reconnect loop is the `down` state", but `fromStart` is a second, hand-rolled backoff loop in `client.ts`. The charter's file list does mention it.
      - The callback named `settle` is called on every failed attempt and does not settle: it only records `lastErr`. That name misled me until I read the body of `keepTrying`.
   8. **The overloaded third argument of `WireType.read`**, `pdu.ts:249` (`readParams` passes `sm_length` to every param reader) and `defs/types.ts:280` (`tlvInt`).
      - For a mandatory parameter it is `sm_length`; for a TLV it is the TLV header length.
      - Only `buffer` and the tlv variants use it, and nothing names the dual meaning. I found it by grepping callers. It stayed half-opaque until then.

2. **The unit I would least want to modify:** `Reassembler.collect` + `trim` together with `ExpiringGroups.weigh`.
   - Weight accounting is spread across `set` (zeroes the weight), `weigh` (evicts, possibly the caller's own key) and `trim` (recomputes the group total from scratch).
   - Every refusal path decides a peer-visible status, and a lost group is reported to the application as traffic gone. An off-by-one there is silent data loss.

3. **Expected hard, found easy:**
   - The codec tables (`defs/commands.ts`, `defs/tlvs.ts`) and the TLV typing, including `tlvSpecs` keying each definition to its own name.
   - `PduFramer` and `PduTransport`.
   - The DLR parsing in `dlr.ts`: every regex and every fallback has a one-line reason.
   - `SessionLife` itself, thanks to the diagram.
   - GSM packing (153 vs 134). The `segmentUnits` comment, plus the AGENTS section "GSM 7-bit is sent unpacked", made it obvious even to someone who knows nothing about SMPP.

4. **Prose debt**
   - **What I needed and what it cost:**
     - The README "SMPP terms" table (ESME/SMSC, `esm_class`, UDH, `sar_*`). Cheap to find, essential without domain knowledge.
     - The README sections "Sends and the link", "Receiving in depth" and "Server in depth", to confirm the intent behind items 1 and 4. Each took a scroll-and-search.
     - The AGENTS architecture map, for navigation.
     - Several `// SMPP 3.4 x.y.z` comments point at a spec I have never read, and I had to take them on trust. Examples: `respIdParams`, `refusalAnswer`, `messageClassOf`.
     - The AGENTS decision index gives titles only. Twice (the drain ordering, and `data_coding` ownership in the codec) the title told me a rule existed without telling me the rule, and the reasoning lives in `docs/decisions.md`, which I was told not to open.
     - I opened no tests.
   - **Prose that told me nothing the code did not:**
     - For reading `src/`: the AGENTS test-conventions bullets (fixtures, `resume()`, `t.after` ordering) and the "Defects found in 0.4.0" table, which is history about another codebase.
     - The README Goals and Audience.
     - A few restating doc comments: `PendingRequests.deliver` ("False means nobody was"), `LinkTimers.clear`'s neighbours, `defs/index.ts`'s grouping.
     - The duplicate `emit` / `captureRejectionSymbol` guard comments in `session.ts` and `server.ts`.

5. **Scores.** Intrinsic difficulty is moderate to high (wire protocol, reconnect, backpressure, multipart), and it gets no bonus below.
   - **Navigation 8.** Between 7 and 9: the AGENTS file map plus one concept per file (`dlr-merger.ts`, `link-waiters.ts`, `pdu-refusal.ts`) got me from a symptom to the right file cold every time. The one detour was the second reconnect loop living in `client.ts`.
   - **Locality 6.** Between 5 and 7: `SessionLife` does centralise the state, but the answered-or-not state spans `IncomingRequests`, `HandledMessages` and `Sms`. `ExpiringGroups` also pushes enforcement of its own invariants onto three owners, and link identity is a shared `Socket` reference compared across modules.
   - **Shape 7.** Predictable: fan-out is bounded (`Session` wires about six collaborators through narrow option objects) and most names tell the truth. It is held there by a few that lie or hide effects: `closing()` mutates, the `settle` callback in `keepTrying` does not settle, and `IncomingRequests.clear()` also empties the handled messages.
   - **Self-sufficiency 7.** Predictable: nearly every non-obvious line carries a one-line why, often with a spec reference, and the hard corners are marked. It stays below 9 because several rules (codec `data_coding` ownership, drain ordering) exist in the code as outcomes whose reasons are only indexed titles, and the domain vocabulary needs the README glossary open.
   - **Overall 7.** Capped at 7 by Locality 6. A cold mid-level reader knows within a day which corners to fear (items 1, 2 and 3 above). They are few and marked, but item 1 is harder than the problem requires.

SCORES nav=8 loc=6 shape=7 self=7 overall=7

## Draft E, senior seat

**Comprehension panel report: senior maintainability seat, `@larvit/smpp` (draft-e), whole project**

I read `README.md`, `AGENTS.md` and every file under `src/`, including `defs/`. I opened no tests.

## 1. Hardest places, hardest first

1. **`src/reassembly.ts:187` `Reassembler.trim()`, and `src/expiring-groups.ts:70` `ExpiringGroups.weigh()`**
   - `weigh()` can evict the group that is being weighed. `trim()` then has to work out whether that group survived. It also counts only `parts.size - 1` segments as lost when that group is the victim, because the new segment "stays with the peer".
   - To get this right I had to hold four things at once: `weigh`'s eviction order, `takeOldest → delete → idle`, the "answered" arithmetic, and the caller in `collect()`, which answers `full`.
   - The inline comments made it clear in the end, after two passes.

2. **`src/expiring-groups.ts:19` `ExpiringGroups`, as a contract**
   - The class docstring says it "enforces neither max nor timeout itself", so every owner has to call `full` and `takeExpired()` in the right order.
   - `HandledMessages` stretches this across two classes. `IncomingRequests.onMessage` (`incoming-requests.ts:218`) calls `handled.refuses()` before reassembly, and `offer()` comes later, when the message is whole.
   - Nothing states that the cap holds only because `refuses()` ran first. I had to reconstruct that myself, and it stayed implicit.

3. **`src/session-life.ts:115` `SessionLife.enter()` / `:175` `attempt()`, with `src/session.ts:260` `lifeFor()`**
   - The ASCII transition table in the header is the best piece of prose in the repo.
   - Two things cost me:
     - The header says "a transition from any other state is ignored", but `enter()` has no guard. The guards live in the public wrappers (`bound()`, `closing()`, `linkLost()`, `end()`), so I had to check each one.
     - The effects are closures defined in `Session`. To follow `down → connected → bound` I had to jump between `session-life.ts`, `session.ts` `lifeFor`/`linkDown`, `OutgoingRequests.linkUp`/`linkLost` and `PduTransport.attach`.
   - `attempt()`'s re-check after the await (`this.links !== link || !this.is('connected')`) is commented and fine.

4. **`src/client.ts:240` `retryUntilBound()` / `:278` `keepTrying()`**
   - This is a second backoff loop, separate from `SessionLife`'s. The charter and README say `fromStart` goes "through that same loop", but it doesn't: it's a separate loop that uses the same `Backoff` class.
   - The callback type is named `Settle`, but on an error it doesn't settle anything; it only records `lastErr`. You learn that from a comment inside the lambda in `keepTrying`.
   - Add the `waiting()` closure and an abort listener, and this is four nested pieces of control flow for one feature. It resolved in the end, but the name misled me along the way.

5. **`src/pdu.ts:84` `resolveShortMessage()` / `:113` `resolveBody()`**
   - The `CodingSource` rule decides which of `short_message` and `message_payload` may rewrite `data_coding`. It depends on whether the command's table has a `short_message` at all, on Buffer vs string, and on zero length.
   - The comment on the `CodingSource` type states the rule, but I had to trace three return shapes to confirm it.
   - Next to it, `readParams()` (`:240`) passes `sm_length` as the length argument to every param read. That works only because `sm_length` comes earlier in wire order. `commands.ts` documents wire order, but not that this depends on it.

6. **`src/sms.ts:126` `sendResp()`, with `src/session.ts:304` `answer()`**
   - `sendResp` checks the socket the message arrived on, `link.destroyed`. `answer()` then writes to `transport.sock`, the current socket.
   - This is correct only because a socket is replaced only after it has been destroyed (`PduTransport.attach`).
   - `IncomingRequests.handle()` (`:104`) relies on the same equivalence. It is not stated anywhere I read.

7. **`src/handled-messages.ts:120` `HandledMessages.run()`**
   - Covers expiry, a handler failure, answering after the handler settles, and the identity check `running.get(key) !== sms`, which catches a `clear()` or sweep that ran in the meantime.
   - The class docstring covers it. It is compact but dense.

8. **`src/defs/encodings.ts:163` `messageClassEncoding()` / `encodingByDataCoding()`**
   - Bit-twiddling over GSM 03.38 coding groups that I had no background for.
   - The comments are adequate. The problem is inherently hard; it is not badly written. Stacking a `//` comment on top of a `/** */` comment made it unclear which one belonged to which function.

## 2. The unit I would least want to modify

`Reassembler.trim()` together with `ExpiringGroups.weigh()`.

- The eviction, the "is the current group gone" question, the lost-segment count and the ESME-facing status (`full` → throttled) are all spread over two files, and each file assumes the other's behaviour.
- A wrong change here silently loses traffic the peer will never resend, which is the README's worst outcome.
- Nothing in the code would stop me. Only a test would catch the mistake.

## 3. Expected hard, found easy

- **Framing (`pdu-framer.ts`):** short, and the quadratic-join rationale is right there.
- **The send path:** `OutgoingRequests.request/sendOnce/attempt`. The `written` flag makes "resend or not" a single boolean.
- **`PendingRequests` and `SendWindow`**
- **The TLV table's self-keyed generic**
- **Receipt parsing (`dlr.ts`)**
- **`splitMessage`:** the budget comment together with the charter's "GSM 7-bit is sent unpacked" section settled the 153/134 question at once.

## 4. Prose debt

**Needed:**
- The `session-life.ts` state table: essential, and cheap to find.
- `AGENTS.md`'s file map: accurate, and the fastest route from a symptom to a file.
- The charter's "GSM 7-bit is sent unpacked" section.
- README "Server in depth", to understand why segments are answered on arrival.

**Missing:**
- The invariants in items 2 and 6. They are written down nowhere I was allowed to read.
- The decisions index points at `docs/decisions.md`, which I couldn't open. Twice (the `fromStart` "same loop" wording, and the abort-dance duplication) the one-line index entry made a claim the code did not obviously bear out, and there was nothing local to check it against.

**Prose that told me nothing new:**
- The `/** Injected so expiry can be exercised without a wall clock. */` comment, repeated on four option types.
- `// Called unbound, so the application's hook never sees this class as its this` (`incoming-requests.ts`).
- Most of the charter's test-convention paragraph (fixtures, `recordingDeps`), which is irrelevant for reading `src/`.
- Much of the defect table, as far as reading `src/` goes.

## 5. Scores

- **Navigation 7:** Predictable. The `AGENTS.md` file map is accurate line by line, and file names match their content (`link-waiters`, `pdu-refusal`, `sms-id`), so I landed first try on every symptom I tried. It doesn't reach 9 because `defaults` are applied in three different layers (`Session`, `IncomingRequests`, `Reassembler`), so finding "where does this default apply" takes a search.
- **Locality 6:** Between honest middle and predictable. It is held down by three unwritten cross-class invariants: owners enforce `ExpiringGroups`' limits, `refuses()` must run before `offer()`, and a destroyed arrival socket stands in for the current socket. `SessionLife`'s effects are also closures back into `Session`.
- **Shape 7:** Predictable. Every file is small, fan-out per level is bounded, and names mostly tell the truth. It is kept from 8 by a few names that mislead:
  - `closing()` is a transition, not a predicate.
  - `Settle` doesn't settle on an error.
  - `bound()` exists on two layers with different contracts.
  - `onRequest` names both the server's wrapper and the application's hook.
- **Self-sufficiency 7:** Predictable. The why-comments sit on the lines that need them, and spec section numbers are cited. It is held back by a charter index that points to a decisions file whose claims I could not check locally.
- **Overall 6:** The capped maximum is 7 (lowest dimension plus one). I gave 6 because the costs are concentrated in exactly the bounded-store and link-identity code where a mistake loses traffic.

The problem itself is moderately hard: flow control across two peers, the SMPP body and encoding rules, and reconnect races. That earns no bonus.

SCORES nav=7 loc=6 shape=7 self=7 overall=6

## Draft E, architect seat

# Comprehension panel, seat "Architect, inherited": @larvit/smpp (draft-e)

I read README.md, AGENTS.md and every non-test file in src/. I opened no test, ran nothing, edited nothing and ignored the pre-loaded AGENTS.md.

## 1. Map from README.md and `ls -R src test` only (verbatim)

> Flat `src/` of 36 files plus `defs/` (7). I expect seven areas that the layout does not show:
> A. **Spec tables**, `defs/`: commands, constants, encodings, errors, TLVs, wire types, plus an index grouping them.
> B. **Codec**: `pdu.ts` (pduToObj/objToPdu), `pdu-framer.ts` (stream to PDUs), `pdu-refusal.ts` (PduRefusedError), `retained-pdu.ts` (?), `result.ts`, `error-from.ts` (?).
> C. **Message content**: `message.ts` (encode/split/bitCount, and probably smppTime), `message-body.ts`, `concat.ts`, `udh.ts`, `reassembly.ts`, `expiring-groups.ts` (a TTL map, probably under reassembly).
> D. **Receipts**: `dlr.ts` (parse *and* build receipts), `dlr-merger.ts` (messageDlr), `sms-id.ts` (hex/decimal ids).
> E. **Session core**: `session.ts`, `session-life.ts` (?), `session-options.ts` (types), `defaults.ts`, `link-timers.ts` (enquire_link/idle), `backoff.ts` (reconnect loop?), `pdu-transport.ts`, `link-waiters.ts` (?), `idle-waiters.ts` (?).
> F. **Request flow**: `outgoing-requests.ts`, `pending-requests.ts` (seq/correlation), `send-window.ts`, `unanswered-error.ts`, `send-sms.ts`, `incoming-requests.ts`, `sms.ts` (the onSms handle), `handled-messages.ts` (messages whose onSms runs, for the bound and the drain).
> G. **Entry points**: `client.ts`, `server.ts`, `index.ts`, `log.ts`, `uuid.ts`.
> Names that do not give their purpose: session-life, link-waiters vs idle-waiters, retained-pdu, error-from, defaults vs session-options, and backoff (a loop or only a delay?).
> Expected from the README but missing: the goal-9 store (the README says it has not shipped). At the repo root, MIGRATION-NOTES.md and DESIGN.md sit beside the six documents the charter names, with no stated purpose.

### Corrections, cheapest first

| Map guess | Reality | Cost |
|---|---|---|
| backoff.ts is the reconnect loop | Delay arithmetic only. The loop is the `down` state of `SessionLife`. | Low. The AGENTS table says so. |
| link-waiters / idle-waiters | Requests waiting for a bound link / a count falling to zero | Low |
| dlr.ts parses and builds receipts | Building lives in `sms.ts` (`receiptText`, `sendDlr`, `collectReceipt`) | Medium. I went to dlr.ts first, then grepped for `stat:`. |
| session-options.ts is option types | Also holds `SessionEvents`, bind-direction logic (`bindCarries`, `standsInFor`, `bindCommands`) and all option validation (`checkSessionOptions`) | Medium. The name hides three concerns. |
| Whole-message decoding lives in message.ts | `decodeSegments` is in `reassembly.ts:63` and is called from `sms.ts` | Low-medium |
| One reconnect loop | Two. `SessionLife.attempt/schedule`, plus a second in `client.ts:240` `retryUntilBound`/`keepTrying` for `fromStart`. Both log `'reconnect - retrying'`. | Medium. The same log line from two places is a 3am trap. |
| retained-pdu, error-from | Heap-detach and weight of a held PDU; turning a thrown value into an Error | Low. The AGENTS table covers both. |

## 2. Fan-out by level

- **Repo root:** about 8 prose documents (README, AGENTS, CHANGELOG, MIGRATION, MIGRATION-NOTES, DESIGN, todo, CLAUDE) plus 5 directories. MIGRATION-NOTES and DESIGN are not in the charter's "each file answers one question" list.
- **`src/`, the worst level:** 37 entries. They fall into 7 real areas, but only the AGENTS.md table shows that. Without the table this level is past any bound you can hold at once.
- **`src/defs/`:** 7. Good.
- **Within the session:**
  - `Session` holds 8 collaborators.
  - `OutgoingRequests` holds 3 (PendingRequests, LinkWaiters, SendWindow).
  - `IncomingRequests` holds 2 (HandledMessages, Reassembler) plus 6 injected fields.
  - `HandledMessages` holds 2 (ExpiringGroups, IdleWaiters).
  - Depth is at most 4 and fan-out at most 8 per level. Bounded.
- **Files:** most are under 250 lines. `defs/types.ts` (684 lines) is long but uniform: one wire type after another.

## 3. Names

**Misleading:**
- `SessionLife.closing()` (`session-life.ts:97`) reads like a predicate but performs the transition and returns whether it did. `carries()` and `attached()` next to it really are predicates.
- `session-options.ts` holds events, bind direction and validation as well as options.
- The comment on `SessionOptions.shutdownTimeout` (`session-options.ts:117`) says "How long a drain waits for the requests already on the wire". It also bounds the wait on running handlers (`session.ts:324`). That comment is false.
- In `client.ts:234,288`, `Settle` is called once per failed attempt as well as on success, so it does not settle anything.
- `maxOctets` (a public option) bounds reassembly only. The handled-message octet cap is a separate constant, `maxHandledOctets`.

**One name over several concepts:**
- **`idle`** has four meanings:
  - A count reaching zero: `IdleWaiters`, `SendWindow.idle`, `HandledMessages.idle`.
  - Stopping the sweep timer: `ExpiringGroups.idle()`.
  - The idle-timeout timer: `LinkTimers.idle`.
  - The `idleTimeout` option.
- **`settle`** has four meanings: wake all waiters (`IdleWaiters.settle`), wake only if the count is zero (`HandledMessages.settle`), resolve one request (`PendingRequests.settle`), and the local `settle` closures in LinkWaiters, SendWindow and client.
- **`link`** means the socket (`SmsInput.link`, `const link = this.session.sock`), the connection's lifetime (`LinkState`, `LinkTimers`, `LinkWaiters`) and which end of the connection this is (`LinkEnd`).

**Two names for one concept:**
- The lost link is spelled `linkLost` (the SessionLife transition and `OutgoingRequests.linkLost`) and `linkDown` (the LifeEffects hook and `Session.linkDown`).
- The end of the session is spelled `end()`, the state `ended`, and the effect `over`.
- A message whose handler is running is spelled "handled" (the class and its logs), `running` (its field) and "being handled" (README).

## 4. What I would restructure, ranked

1. **Group `src/` into about 6 directories:** `codec/` (pdu, framer, refusal, retained-pdu, defs), `message/` (message, message-body, concat, udh, reassembly), `receipts/` (dlr, dlr-merger, sms-id, and receipt building moved out of sms.ts), `session/` (session, session-life, link-timers, pdu-transport, backoff), `requests/` (outgoing/pending/send-window/link-waiters/idle-waiters, incoming/handled-messages/sms), and top level (client, server, index). Today the AGENTS table does the job the directory tree should do.
2. **One retry loop.** Have `fromStart` reuse the `SessionLife` loop, or give client.ts's loop a distinct name and log line.
3. **Split `session-options.ts`** into `bind-direction.ts` and `option-checks.ts`, and move `SessionEvents` into `session.ts`.
4. **Retire the overloaded verbs** (`idle`, `settle`, `linkLost`/`linkDown`) and rename `closing()` to something like `beginDrain()`.
5. **Deduplicate the collectors.** `collectReceipt` (`sms.ts:182`) is `collectSent` (`send-sms.ts:274`) without ids.

**What the structure gets right:**
- `SessionLife` is one state value with the transition diagram in its own header (`session-life.ts:7-24`). Effects reach the rest of the session only through `LifeEffects`.
- `OutgoingRequests` reads state through a function and never copies it.
- Every collaborator takes a narrow options object.
- Result types are used throughout, so control flow has no second error channel.
- The comments are dense and mostly say why, not what.
- The AGENTS table matches the code file for file.

## 5. The 3am question

**Symptom:** during a graceful shutdown the session hangs until the shutdown timeout, even though the application already called `sms.sendResp()` on every message.

**Cold path, about 3 to 5 minutes:**
1. `Session.close` (`session.ts:235`) calls `drain` (`session.ts:317`).
2. That calls `this.incoming.drain(timeout)` (`incoming-requests.ts:163`).
3. That calls `HandledMessages.idle` (`handled-messages.ts:106`).
4. The unit is **`HandledMessages.run`** (`handled-messages.ts:120`). A message leaves `running`, which is what releases the drain, only after `onSms`'s promise settles. `sendResp()` records the answer and releases nothing.

**Likely cause:** the handler is still awaiting something, typically `sms.sendDlr()`. That goes through `handlers.send`, which is `outgoing.request`: it bypasses the closing-state refusal and waits up to `responseTimeout` (30 s), which is longer than `shutdownTimeout` (5 s).

**What gets you there:** the README (lines 107-109) and the `OnSms` doc (`session-options.ts:87-92`) both say the handler's promise is the hold. **What slows you down:** the `Sms.sendResp` doc (`sms.ts:47-51`) says nothing about the hold, and the `shutdownTimeout` comment wrongly claims it only bounds requests.

**Where it rots first:** the wiring in `Session`'s constructor and `transportFor`/`lifeFor`/`incomingFor` (`session.ts:105-294`).
- Eight collaborators are cross-wired through closures that capture `this.life` and `this.transport` before those are assigned. That is safe today only because of construction order.
- `IncomingRequests` reaches back into `Session` for `sock`, `close()`, `emit`, `bindAllows`, `boundAs` and `linkEnd`, so the dependency runs in both directions.
- Every lifecycle feature touches three files: session-life (transition), session.ts (effect) and the collaborator.

**Where the next two features land:**
1. **The goal-9 store** lands under `ExpiringGroups`, which has three owners: `DlrMerger`, `Reassembler` and `HandledMessages`. Each wraps it differently (weigh-evicts, a "spent" set, sweep callbacks), so a persistent seam would have to be cut three times or `ExpiringGroups` would have to become the store interface.
2. **A per-PDU rate-limit hook** lands in `OutgoingRequests.sendOnce` (`outgoing-requests.ts:116`), between the window acquire and `attempt`, and must respect the rule that a written request is never retried. The code states that rule, so the change is contained. An alphabet hook would be far worse: `EncodingName` is a closed union that ripples through defs/encodings, message.ts and send-sms.ts.

## 6. Hardest places, ranked

1. `session.ts:105-294`, `Session` constructor plus `transportFor`/`lifeFor`/`incomingFor`: closure wiring, and initialisation order matters.
2. `session-life.ts:175`, `SessionLife.attempt`: re-enters after two awaits and guards with the `links` counter plus `is('connected')`. It is correct, but you have to hold the whole diagram to read it.
3. `session.ts:218`, `Session.unbind`: the `wasOpen`/`closedOnUnbind` arithmetic and the order of error precedence.
4. `outgoing-requests.ts:97-183`, `request`/`sendOnce`/`attempt`: a `for(;;)` retry keyed on `written` and a fresh `state()` read.
5. `handled-messages.ts:62,120`, `refuses()` (a query that mutates the hysteresis flag and sweeps) and `run()` (answer after settle, then conditional delete).
6. `pdu.ts:84-136`, `resolveShortMessage`/`resolveBody`: which field's encoding sets `data_coding`.
7. `reassembly.ts:187` `trim` with `expiring-groups.ts:70` `weigh`: eviction can take the current key, with off-by-one accounting of lost parts.
8. `client.ts:240-309`, `retryUntilBound`/`keepTrying`: the second loop and its misnamed settle callback.

**The unit I would least want to modify** is `SessionLife.enter` (`session-life.ts:115`) together with its effect bindings in `Session.lifeFor` (`session.ts:260`). One transition's meaning is split across two files and five callbacks.

**Intrinsic difficulty is high**, and none of the scores below credit it: an async protocol with reconnect, drain, correlation, reassembly and a byte-exact codec against peers that do not follow the spec.

## 7. Scores

- **Navigation 7:** at the "Predictable" anchor. The AGENTS file table plus accurate file names got me from the 3am symptom to `HandledMessages.run` in minutes. It sits no higher because the 37-file flat `src/` depends on that table, and two parallel retry loops share one log line.
- **Locality 6:** between "Honest middle" and "Predictable". `LifeEffects` and the `state()` accessor are real seams. Holding it down: `IncomingRequests` reaches back into `Session`, the constructor wiring depends on order, and one lifecycle change spans session-life, session and a collaborator.
- **Shape 6:** between 5 and 7. Nesting below the top level is bounded (8 at most per level). Holding it down: the 37-entry top level, a misnamed `session-options.ts`, a mutating `closing()`, and `idle`/`settle`/`link` each covering several concepts.
- **Self-sufficiency 7:** at "Predictable". The state diagram, invariant comments and "why" comments sit at the code. Holding it back from higher: the false `shutdownTimeout` comment (`session-options.ts:117`), and `Sms.sendResp` not saying it does not release the drain.
- **Overall 6:** capped at 7 by the lowest dimension plus one. The hard parts are marked but spread across the session wiring, and the top level needs a document to map it.

SCORES nav=7 loc=6 shape=6 self=7 overall=6

## Draft F, junior seat

**Junior A: comprehension report for draft-f**

I read README.md, AGENTS.md and every file under `src/`, all in draft-f. I opened no test.

## 1. Hardest places, hardest first

1. **`src/expiring-groups.ts:38-54, 111`: the `ExpiringGroups` getters `full`, `size` and `weight`, and `get()`, which all call `expire()`.**
   - Reading a property has side effects. It can fire `onDrop`.
   - In `Reassembler`, `onDrop` becomes `onLost`, then `port.report`, then a `sessionError` emit. In `RunningHandlers` it logs a warn and settles the drain's waiters.
   - So `this.running.size` in `IncomingRequests.refusedAtBound` (`incoming-requests.ts:224`) can emit events on the application's emitter. I only found this by following `onDrop` through three classes.
   - No comment at the call sites says so. It stayed a trap even after I understood it.

2. **`src/reassembly.ts:113` (`Reassembler.collect`) with `weighed()` at `:180`, `dropped()` at `:194` and the `weighing` field at `:91`.**
   - `weighing` is a side channel. It is set around a `weigh()` call so that the drop callback, which fires synchronously inside it, can subtract the newest segment from the reported loss.
   - `weighed()` then reads `get(key)` again to find out whether its own group was evicted.
   - To follow it I had to hold several things at once:
     - part and total validation;
     - a group that is new or already there;
     - eviction by count inside `set`;
     - eviction by weight inside `weigh`;
     - the "newest segment stays with the peer" rule.
   - The field's comment explains why but not how. It was resolved only after a second read.

3. **`src/incoming-requests.ts:260` (`onMessage`) and `:292` (`handOver`), together with `sms.ts:126` (`sendResp`) and `:196` (`sendDlr`).**
   - A message's answer is spread over four places:
     - answered on arrival for segments;
     - the handler's return;
     - an early `sendResp()`;
     - the refusal on a throw, which is itself split by `answeredOnArrival`.
   - The shared state is the mutable `answer` object captured in the closures of `createSms` (`sms.ts:80`).
   - `throttledStatus` versus `refusedSegmentStatus` needs the `carriedAs` / `standsInFor` indirection for `data_sm`.
   - The README's "Receiving in depth" section resolved it. The code alone did not.

4. **`src/pdu.ts:84` (`resolveShortMessage`) and `:113` (`resolveBody`).**
   - `CodingSource` decides which of `short_message` and `message_payload` may rewrite `data_coding`.
   - There are five return paths, depending on Buffer or string, empty or not, and a string `message_payload`.
   - `data_coding` is patched onto the params from two places.
   - The type comment at `:74` helps, but I had to trace each branch by hand. It remained partly opaque, for example why an empty encoded string falls to `message_payload`.

5. **`src/defs/encodings.ts:152-191`: `messageClassOf`, `messageClassEncoding`, `encodingByDataCoding`.**
   - Bit masks (`& 0x80`, `>> 2 & 0x03`, `0xF0`) that I had no background for.
   - Two comments are stacked oddly at `:160-162`: a `//` block and then a `/** */`, both describing the function below.
   - It stayed opaque without the GSM 03.38 spec. The intrinsic difficulty is high.

6. **`src/defs/tlvs.ts:110` (`WriteValue`) and `:284` (`keyedTlvs`, with the `isTlvs` guard).**
   - Conditional types nested three deep, plus a runtime re-validation of what the code just built, because casts are banned.
   - Hard rule 4 in AGENTS.md explains why the guard exists. The type gymnastics remained costly.

7. **`src/reconnect-loop.ts:82` (`schedule`), `:127` (`attempt`) and `:64` (`adopt`).**
   - `upAt` resets the backoff only after a link lasted `maxDelay`.
   - `links > 0` decides `unref`.
   - A `stopped` check comes after an `await` in `attempt`.
   - There are three flags (`timer`, `attempting`, `stopped`) guarding re-entry.
   - The comments explain each rule, so it was resolved, but it is order-sensitive.

8. **`src/send-window.ts:42` (`release`).** Handing a slot to a waiter without decrementing `inFlight` is correct but not commented. I had to reason out that the slot transfers.

## 2. The unit I would least want to modify

`Reassembler.collect` / `weighed` / `dropped`. A change to eviction order inside `ExpiringGroups.weigh`, or to when `get()` expires, silently changes the loss counts reported to the application, which are sessionError events. Nothing at the call site tells me that the coupling exists.

## 3. Expected hard, found easy

- **`PduFramer`:** short, one clear purpose.
- **`PendingRequests` and `OutgoingRequests`:** the split between `LinkLostError` ("never written, retry") and `UnansweredError` ("may have been taken") is named well. `SmppClient.send`'s retry loop (`client.ts:143`) read at once.
- **The layering of Session, IncomingRequests and SessionPort:** the port type (`incoming-requests.ts:50`) says exactly what the collaborator may touch.
- **`server.ts` `handleRequest`:** bind-before-anything is compact.
- **`defs/types.ts`:** long but repetitive and uniform.

## 4. Prose debt

**What I needed, and what it cost to find:**

- **README "Glossary":** needed for ESME/SMSC, `esm_class`, `data_coding`, UDH and `sar_*`. It sits about 600 lines down the README and nothing in `src/` points at it.
- **README "Receiving in depth" and "Server in depth":** needed to understand the answer-on-arrival model before `onMessage` made sense.
- **AGENTS "GSM 7-bit is sent unpacked":** needed to believe the 153/134 budget in `message.ts` (the `segmentUnits` constant near the top).
- **The `ASCII` encoding name:** it means GSM 03.38. Only the comment in `encodings.ts` near line 45 and a README table say so. The name lies.
- **Bit layout of `esm_class` and `data_coding`:** not documented anywhere I was allowed to read. I would need the spec.

**Prose that told me nothing the code did not:**

- AGENTS' architecture map repeats most file-level doc comments almost word for word. It was still useful as an index.
- Several Conventions paragraphs about tests (`dummy-smsc`, `recordingDeps`) were irrelevant to reading `src/`.
- AGENTS' decision index names `ReconnectOptions`, which does not exist in `src/`. The type is `ReconnectTuning`. That line is stale.
- Comments that add nothing:
  - `'Whether the socket has closed.'` on `closed` (`session.ts:148`);
  - `'Sends a request and resolves with the peer's response.'` (`session.ts:172`);
  - `'Connects to an SMSC and binds.'` (`client.ts:414`).

## 5. Scores

| Dimension | Score | Anchor and cause |
|---|---|---|
| Navigation | 7 | Predictable. AGENTS' one-line-per-file map and honest file names (`pdu-framer`, `dlr-merger`, `send-window`) took me from a symptom to a file first time. `ASCII` meaning GSM and the three meanings of "refuse" and "answer" (`Session.refuse`, `IncomingRequests.refuse`, `sendReturn` / `answer` / `sendResp`) keep it off 8. |
| Locality | 5 | Honest middle. The getters in `ExpiringGroups` fire callbacks that emit on the session. The `weighing` side-channel field depends on synchronous re-entry. The mutable `answer` closure is shared by `sendResp` and `sendDlr`. Changing one piece means holding its callback chain. |
| Shape | 6 | Between honest middle and predictable. Fan-out is bounded (Session builds four collaborators; IncomingRequests builds two). Some names mislead: `ASCII`; `stopping`, which the peer's unbind also sets; `over` versus `closed`; `SessionListener`'s emit guard copied three times. |
| Self-sufficiency | 6 | Between honest middle and predictable. Inline spec citations ("SMPP 3.4 5.3.2.26", "4.6.2") and why-comments mostly carry it. The answer-on-arrival model and the data_coding bit groups still need the README or the spec open beside the code. |
| Overall | 6 | Capped by Locality (5 + 1). |

**Intrinsic difficulty:** the problem is hard, and gets no bonus in these scores. It involves concurrency, the protocol's split between UDH and `sar_*`, receipts that look like messages, and the GSM alphabets.

SCORES nav=7 loc=5 shape=6 self=6 overall=6

## Draft F, mid seat

1. **Hardest places, ranked hardest first**

- **`src/reassembly.ts:330` `Reassembler.weighed()` / `dropped()` (:344), together with `src/expiring-groups.ts:38-54` (the `full`, `size` and `weight` getters).** `weighed()` sets `this.weighing` so that `dropped()`, reached re-entrantly through `ExpiringGroups.weigh()` → `dropOldest()` → `onDrop`, knows to subtract the newest segment from the loss count. That is a side channel through a field. On top of it, every getter on `ExpiringGroups` runs `expire()`, which fires `onDrop`. So reading `size` in a log line (`reassembly.ts:358`, `this.groups.weight` inside `lost()`) can drop other groups and report them mid-report. The comments at :240 and :274 got me to what it intends. Whether the re-entrant drops are harmless stayed unresolved.
- **`src/session.ts:211-332` `Session.unbind()` / `drain()` / `finish()` / `end()`.** Three flags carry a lifecycle: `over`, `stopping` and the `ended` promise. `closed` is a getter over `over`, and `port().end` (:262) sets `stopping` from outside the drain. `unbind()`'s `droppedOnUnbind` depends on `UnansweredError` and `this.over` agreeing after an await. The field comments (:64, :66) and the class doc resolved which flag means what, but only after I built a table by hand.
- **`src/client.ts:515` `SmppClient.send()`.** It loops on `LinkLostError`. Whether it terminates depends on `ReconnectLoop.bound()` (which hands back the current session until the socket's `close` event), `Session.send()` (which checks `over`, set only on `close`) and `PduTransport.write()` (which fails on `sock.destroyed`). A socket that is destroyed but has not yet emitted `close` looks to me like it gives a loop that resolves only through microtasks and may never yield. I could not rule that out without a test. This is the plainest action-at-a-distance in the codebase, and it stayed opaque.
- **`src/incoming-requests.ts:260-351` `onMessage()` → `handOver()` → `refuse()`, with `src/sms.ts:796-860` `createSms()` / `sendResp()`.** I had to hold several things at once:
  - whether the message was answered on arrival;
  - whether the handler threw;
  - whether it returned `{ smsId }` or `{ status }`;
  - the `Answer` object mutated inside the closure;
  - `carriedAs` choosing the retry status.

  `alreadyAnswered` has four error texts for these combinations. The README section "Receiving in depth" resolved it; the code alone did not.
- **`src/defs/encodings.ts:152-191` `messageClassOf()`, `messageClassEncoding()`, `encodingByDataCoding()`.** This is bit arithmetic on a GSM 03.38 layout I have never seen. There is a `//` comment and then a `/** */` comment stacked on one function (:160-162), and the `//` one reads as though it belongs to the function above. The comments give the bit positions. Why 0x03 means one thing below 0x80 and another in a class group stayed half opaque.
- **`src/dlr.ts:157-238` `messageType()` / `receiptStatus()` / `dlrFromPdu()`.** `'unmarked'` versus `'receipt'`, whether the TLV or the body wins, and `statusMsg` possibly being `undefined` before it falls back to `'UNKNOWN'`. The README's Delivery receipts section resolved it. Without the README I would have guessed wrong about `'other'`.
- **`src/pdu.ts:323-375` `resolveShortMessage()` / `resolveBody()`.** The `CodingSource` naming feels inverted: an empty `short_message` yields `source: 'message_payload'`, meaning "`message_payload` may set `data_coding`". The comment at :313 explains it, but I had to read it twice.
- **`src/reconnect-loop.ts:83` `schedule()`.** It resets the backoff only if `upAt` shows the link outlasted `maxDelay`, clears `upAt`, doubles the delay after capturing it, and calls `unref()` only once a link has existed. Each step has a comment, which resolved it. It is dense rather than opaque.

2. **The unit I would least want to modify: `ExpiringGroups` (`src/expiring-groups.ts`).** Three owners (`Reassembler`, `DlrMerger` with its `spent` store, and `RunningHandlers`) depend on when drops happen and in what order. Reads mutate state and fire callbacks. `set()` can evict. `weigh()` can evict the entry being weighed. Any change moves loss accounting, drain wake-ups and receipt-merge refusal all at once. Note also that `RunningHandlers` logs "giving up on a handler that never returned" for an *eviction*, not only an expiry.

3. **Expected hard, found easy**
   - The wire codec: `defs/types.ts`, `pdu.ts` parse/build, TLV read/write. It is long but regular: every reader range-checks, and every error names the parameter.
   - `PduFramer`.
   - `PendingRequests` and `SendWindow`.
   - The server's bind handling (`handleRequest`).
   - The option validation in `session-options.ts`.

   Result-typed code with no throws made control flow easy to follow.

4. **Prose debt**
   - **Needed:**
     - the README Glossary for ESME, SMSC, `esm_class`, `data_coding`, UDH and `sar_*` (cheap to find, essential for me);
     - the README "Receiving in depth" and "Server in depth" sections, for the answer rules in `sms.ts` and `incoming-requests.ts` (about 10 minutes to locate);
     - the AGENTS "GSM 7-bit is sent unpacked" section, for `segmentUnits` 153 versus 134.

     The AGENTS decision index names choices, such as "A message id base is merged at most once", whose reasoning lives in `docs/decisions.md`, which I was not allowed to open. For a few (the `spent` store and `LinkLostError` retry), the title alone left me unsure whether the behaviour I saw was the intent. The charter also says `IncomingRequests` and `Sms` get "named functions, never the session itself". That is false as written: `SessionPort.session` and `Sms.session` both hand over the full `Session` (`incoming-requests.ts:65`, `:293`).
   - **Told me nothing:**
     - most AGENTS architecture one-liners, which restate the file names;
     - the seven `declare` listener lines, repeated in all three emitters;
     - `/** Whether the socket has closed. */` on `closed`;
     - `defaults.ts`'s "README's option tables restate the public ones";
     - many decision-index bullets that simply restate what the code shows, such as "`reconnect` takes `{ minDelay, maxDelay }`…".

   Intrinsic difficulty: moderate to high. Two alphabets' bit layouts, two concatenation spellings, and receipts sharing a command with messages are the problem's own difficulty, not the code's. They get no bonus.

5. **Scores**
   - **Navigation: 7.** At the "predictable" anchor: `src/` is flat, file names follow concepts (`dlr-merger`, `pdu-framer`, `send-window`), and the AGENTS map matched the tree exactly. It stops short of 8 because of placements like `leftOf` in `idle-waiters.ts` and `refusedSegmentStatus` exported from `incoming-requests.ts`.
   - **Locality: 5.** At the "honest middle": getters with side effects in `ExpiringGroups`, the `weighing` side channel in `Reassembler`, and `SmppClient.send()` being correct only across the timing of three modules are all state changed out of sight.
   - **Shape: 6.** Between 5 and 7. Files are small and fan-out is bounded, but the vocabulary is overloaded:
     - answering: `answer`, `sendReturn`, `sendResp`;
     - refusing: `refuse` in two classes with different meanings, plus `refusedAtBound`;
     - ending: `over`, `closed`, `stopping`, `end`, `finish`, `ended`;
     - and `SessionPort` claims a narrow seam while carrying the whole `Session`.
   - **Self-sufficiency: 6.** Between 5 and 7. Comments cite SMPP sections and state the why in place (for example `respIdParams` and `refusalStatus`). But the answer rules and receipt classification needed README sections open beside them, and the decision index points at reasoning that is not in the code.
   - **Overall: 6.** Capped by locality (5 + 1). The code reads cleanly line by line; what costs is the few places where state moves out of sight.

SCORES nav=7 loc=5 shape=6 self=6 overall=6

## Draft F, senior seat

1. **Hardest places, ranked**

   1. **`src/incoming-requests.ts:260-351`, `IncomingRequests.onMessage` / `handOver` / `refuse`, plus `refusedAtBound` at :224.** Before I could predict the answer to one inbound PDU, I had to hold eight branches at once:
      - the running-handler bound;
      - concatenated or whole;
      - kept or refused, and full or unplaceable, with the refusal status differing between sar and UDH;
      - whole or partial;
      - link already closed;
      - no `onSms`;
      - the handler threw or returned;
      - answered on arrival or not.

      "Who answers the peer, and when" is spread over `onMessage`, `handOver`, `refuse`, `createSms(answeredAs)` and `sms.sendResp`/`alreadyAnswered` in another file (`sms.ts:106-144`). `refusedAtBound` returns a boolean but also writes the answer and flips the `refusing` flag. The comment at :256 and README "Receiving in depth" / "Server in depth" resolved it, but only after two passes.
   2. **`src/reassembly.ts:91,113-137,180-198`, `Reassembler.collect` / `weighed` / `dropped`.** The `weighing` field is a side channel. It is set around `groups.weigh()` so that the synchronous `onDrop` callback, which re-enters `dropped()`, can subtract the newest segment from the reported loss. `collect` also inserts the segment into `group.parts` before it knows whether the group survives the weighing. The comments at :90 and :124 made it resolvable, but only by tracing the re-entrancy by hand.
   3. **`src/expiring-groups.ts:250-266,295-306,323-334`, the `ExpiringGroups` getters `full` / `size` / `weight` and `weigh`.** Reading a property runs `expire()`, which fires `onDrop` callbacks. Through `RunningHandlers` (`running-handlers.ts:259`) that means a plain read of `this.running.size` inside a log call in `refusedAtBound` (`incoming-requests.ts:229`) can log a "giving up on a handler" warning and wake a drain. The class comment says "the expired go on every access". Nothing at the call sites marks it. This stayed partly opaque: I am not certain every caller tolerates it.
   4. **`src/session.ts:211-221,291-332`, `Session.unbind` / `drain` / `finish` / `end`.**
      - There are three lifecycle flags: `over`, `stopping` and `bind`.
      - `stopping` is also set from outside, through `SessionPort.end` (:262).
      - `drain` reads the same state as `this.over` at :294 and as `this.closed` at :303.
      - `unbind` deliberately bypasses `send()`'s stopping check by calling `outgoing.request` directly, uncommented.
      - `droppedOnUnbind` needed its docblock plus the charter's decision index ("a close arriving after our own unbind is clean") before I trusted it.
   5. **`src/client.ts:143-156,202-217,415-438` with `src/reconnect-loop.ts:64-153`, `SmppClient.send` retry loop / `takeFirst` / `keepTrying` / `ReconnectLoop`.** The `LinkLostError` contract spans four files. `send-window.close` sets it for queued requests and `OutgoingRequests.attempt` sets it on a write failure (`outgoing-requests.ts:269,287`). `SmppClient.send` consumes it, with `ReconnectLoop.bound`/`release` in between. The first session is opened outside the loop and then `adopt`ed. `links === 1` means "first", and `links > 0` decides `unref()`. Resolved by the `LinkLostError` class doc and the README's "Sends and the link".
   6. **`src/pdu.ts:74-136`, `resolveShortMessage` / `resolveBody`.** The rule for which of `short_message` and `message_payload` may overwrite `data_coding` uses `CodingSource`. An empty Buffer counts as `message_payload`, and only a non-empty encoded `short_message` rewrites the coding. I read it three times. The `CodingSource` doc resolved it.
   7. **`src/defs/encodings.ts:476-515`, `messageClassOf` / `messageClassEncoding` / `encodingByDataCoding`.** This is bit arithmetic over GSM 03.38 coding groups that I had no background in. A `//` comment and a `/** */` for different concerns are stacked on one function (:484-486). The comments carry the rule, so it was domain cost rather than code cost.
   8. **`src/defs/tlvs.ts:103-126,284-306`, the `WriteValue` / `Repeated` conditional types and `keyedTlvs` → `isTlvs`.** The type layer takes a slow read. The runtime re-validation that ends in "a defect in this library" exists only to avoid a cast. I understood why only through hard rule 4 in the charter.

2. **The unit I would least want to modify:** `IncomingRequests.onMessage`/`handOver` together with `sms.ts` `sendResp`/`alreadyAnswered`. The invariant "every PDU gets exactly one answer, and no answer names an id or refusal after the segments were answered" is not stated in one place. It is enforced jointly by the `answeredAs` argument, the mutable `answer` object captured in `createSms` closures, the `closed()` check placed after `createSms`, and `refuse`'s `answeredOnArrival` branch. A change to any one of these can double-answer or silently drop, and only a test would tell me.

3. **Expected to be hard, found easy:**
   - The codec: `pdu.ts` read/write, `defs/types.ts` wire types, `pdu-framer.ts`. It is long but uniform and bounds-checked the same way everywhere.
   - `PendingRequests`, `SendWindow` and `IdleWaiters`: small, one job each.
   - `dlr.ts` receipt parsing, with the operator quirks commented inline.
   - `send-sms.ts`: a linear checklist, then fan-out.
   - The server bind composition in `server.ts:508-533`.

4. **Prose debt**
   - **Needed:**
     - README "Receiving in depth" and "Server in depth", for answered-on-arrival semantics and the retry statuses. Found by the table of contents, so the cost was low.
     - The charter's architecture map. It was the most valuable document: every file is listed with a truthful one-liner.
     - The decision index titles. They told me that behaviours like the unbind-close and five-minute handler were deliberate. With `docs/decisions.md` off-limits, a title was sometimes all I had.
     - I opened no tests.
   - **Told me nothing new:**
     - The AGENTS.md "Defects found in 0.4.0" table (history, irrelevant to reading `src/`).
     - The long test-fixture convention paragraphs.
     - README "Methods", which lists names already typed.
     - Comments that restate code:
       - `session.ts:148` "Whether the socket has closed."
       - `session.ts:172` "Sends a request and resolves with the peer's response."
       - `server.ts:631` "Starts listening… Resolves once the socket is bound."
       - `tlvs.ts:14` "Ordered by tag id", which repeats the charter.
     - The seven `declare` listener lines, copied across three emitters, are boilerplate rather than prose, but they are reading cost all the same.

5. **Scores**
   - **Navigation 8:** between "predictable" and "near duress-proof". AGENTS.md's file map matches `src/` one-to-one, and names like `pdu-refusal.ts`, `send-window.ts` and `dlr-merger.ts` lead from a symptom to the file first try. The detour is the answer path, split across `incoming-requests.ts` and `sms.ts`.
   - **Locality 6:** between "honest middle" and "predictable". The seams are named and narrow (`SessionPort`, `SmsDeps`, `SendSmsDeps`, `LinkLostError`). Three things still break locality:
     - `ExpiringGroups` getters fire callbacks on read.
     - `Reassembler.weighing` is a re-entrancy side channel.
     - `Session`'s flag trio is mutated through `port.end`.
   - **Shape 7:** "predictable". No file is past about 440 lines and fan-out per level is small. A few names mislead:
     - `ExpiringGroups` is used for running handlers and spent ids, which are not groups.
     - `closed` and `over` are two names for one state.
     - `refusedAtBound` answers the peer as a side effect.
     - `ReconnectLoop.attempt`'s comment calls the library's own connect and bind "the application's".
   - **Self-sufficiency 7:** "predictable". Comments carry the SMPP section and the why at the non-obvious points (`sms-id.ts:623`, `message.ts:13`, `dlr.ts:247-253`, `pdu-refusal.ts:446`). The answered-on-arrival contract is the one thing that needed the README open beside the code.
   - **Overall 7:** capped at 7 by locality. A cold senior is productive within a week and knows which corners to fear. Intrinsic difficulty is moderately high (protocol quirks plus a concurrent drain and reconnect), and that earns no bonus.

SCORES nav=8 loc=6 shape=7 self=7 overall=7

## Draft F, architect seat

**Architect, inherited: comprehension report on @larvit/smpp (draft-f)**

## 1. Map from README and tree only (verbatim, written before opening any source)

Top-level areas I expect, although `src/` is flat and shows none of them:
1. **Public handles**: `index.ts`, `client.ts` (SmppClient, reconnecting), `server.ts` (listener, one Session per connection), `session.ts` (one socket's life), `sms.ts` (the inbound `sms` handle with sendResp/sendDlr).
2. **Session machinery**: `link-timers` (enquire_link and idle), `reconnect-loop` (backoff), `send-window` (maxOutstanding), `pending-requests` (seqNr correlation and timeout), `outgoing-requests` (window plus pending), `incoming-requests` (dispatch of peer requests), `running-handlers` (onSms handlers in flight, "Handlers still running" in the README), `idle-waiters` (maybe the idle timeout?), `pdu-transport` and `pdu-framer` (socket to PDUs).
3. **Codec**: `pdu.ts`, `pdu-refusal` (PduRefusedError), `retained-pdu` (a PDU kept for retry?), and `defs/` for the spec tables and wire types.
4. **Message content**: `message.ts` (encode, split, bitCount, smppTime), `message-body` (short_message vs message_payload), `concat` and `udh` (probably the reading and writing of concatenation), `reassembly`, `expiring-groups` (the reassembly store?), `send-sms` (submit composition).
5. **Receipts**: `dlr.ts`, `dlr-merger` (messageDlr), `sms-id` (notations, `<base>-<n>`).
6. **Plumbing**: `result`, `log`, `error-from`, `uuid`, `defaults`, `session-options`, `unanswered-error` (went out, no answer), `link-lost-error` (never reached the socket).

Names that do not give their purpose: `idle-waiters`, `retained-pdu`, `expiring-groups`, `error-from`, and `defaults` vs `session-options`.

What the README led me to expect: a store interface (goal 9). The README itself says it has not shipped, so its absence is fine.

## Where the map was wrong, and what each correction cost

- **`idle-waiters`** is a primitive that waits for a count to fall to zero. It is not the idle timeout, and it also exports `leftOf()`, the deadline arithmetic `client.ts` uses. Cost: low. The misleading part is `leftOf` living there.
- **`retained-pdu`** copies a PDU off the wire so holding it does not pin the chunk, and weighs what holding it costs. It has nothing to do with retry. Cost: low. The copy invariant is split with `defs/tlvs.ts:250`, which already copies TLVs, so `retained-pdu.ts:5`'s claim that "wire reads hand back views" is only half true.
- **`expiring-groups`** is a generic capped, weighed, expiring map. Besides reassembly it also backs `DlrMerger` (twice) and, surprisingly, `RunningHandlers` as a counter (`ExpiringGroups<true>` keyed by serial). Cost: medium. "Groups" misleads for the handler counter.
- **`concat` / `udh`**: splitting is in `message.ts`. `udh.ts` holds the outgoing `ConcatReference` counter plus the parse `concatInfo`. `concat.ts` chooses between UDH and `sar_*`. Cost: medium. It took three files to place the concatenation concepts.
- **`session-options`** is not only options. It also holds bind-direction policy (`bindCarries`, `standsInFor`), `SessionEvents`, the hook types, and validation for client- and server-only options (`authenticate`, `connectTimeout`, `reconnect`, `fromStart`). Cost: medium. I would never have looked there for "which way does a data_sm travel".
- **`pdu.ts` depends on `message.ts`** (`encodeBody`, `decodeMessage`), which depends on `udh.ts`. So the codec sits above the message layer, not just above `defs/`. Cost: low, but the layering in the AGENTS text is incomplete.
- The rest of the map held.

## Fan-out, level by level

- **L0, the repo:** `src`, `test`, `docs`, `benchmarks`, `interop-tests`, plus about 8 top-level `.md` files. Fine.
- **L1, `src/`:** 36 files plus `defs/`, so 37 entries. **This is the worst level.** About six real areas exist, but the layout shows none of them. The only map is the Architecture block in AGENTS.md.
- **L2, `defs/`:** 7 files, clean.
- **L3, the big units:**
  - `Session` composes 4 collaborators plus a hand-built `SessionPort` of 12 members.
  - `IncomingRequests` holds `Reassembler`, `RunningHandlers`, `createSms`, the port and the hooks, and imports 23 symbols.
  - `SmppClient` holds `ReconnectLoop`, `DlrMerger` and `ConcatReference`, plus about 200 lines of free connect and bind functions.

## Names

**Names that mislead**
- `IncomingRequests.drain` (`incoming-requests.ts:147-153`) calls the count of running handlers `unanswered` and reports "Shut down with N message(s) unanswered". A handler that already called `sendResp()` is still counted. That is the 3am bug's own error text pointing the operator at the wrong thing.
- `RunningHandlers`' `onDrop` logs "giving up on a handler that never returned" for any drop, including an `evicted` one. Eviction can only be avoided because `refusedAtBound` is checked first, somewhere else (`running-handlers.ts:28`).
- `session-options.ts`, as above.
- `decodeSegments` lives in `reassembly.ts` but is used by `sms.ts`.
- `ExpiringGroups` used as a counter.

**One name over several concepts**
- **refuse:** `Session.refuse` (codec-refused PDU), `IncomingRequests.refuse` (application did not take the message), `refusedAtBound`, `Refusal` (a reassembly slot), `refusedSegmentStatus`, `refusalAnswer`, `PduRefusedError`.
- **end:** `Session.end`, `OutgoingRequests.end` and `IncomingRequests.end` all mean "the socket is gone". `SessionPort.end` means "the peer unbound, destroy the socket". `SmppClient.end` means "the client is over".
- **answer:** `SessionPort.answer` writes a response. `sms.ts`'s `Answer` is mutable answered-state. `answerOf` converts the handler's return.
- **closed:** a public getter on `Session`, a private field on `SmppClient`, and a port function.

**One concept with two names**
- Session lifecycle: `over` / `closed`, and `stopping` / "shutting down".
- The UDH indicator is checked through `hasUdh` in 5 places, and the body is sometimes `params.short_message` (a string, or a Buffer when a UDH is present) and sometimes `shortMessageOctets`.
- The submit bind check is spelled twice: `client.ts:159` reads `options.bindType`, `session.ts:195` calls `bindAllows`.

## Restructure, ranked

1. **Split `IncomingRequests`.** Routing (`route`, `unhandled`, `onDelivery`) is one piece. Message intake (bound refusal, reassembly, answer-on-arrival, `handOver`, `refuse`) is a second, called something like `MessageIntake`. It is the densest unit and the one that grows.
2. **Carve bind-direction policy out of `session-options.ts`** into `bind-direction.ts`, and move client/server option validation next to its owners or into an `option-checks.ts`.
3. **Make the "drain waits on" counter say what it counts.** Either release it on `sendResp()` plus pending receipts, or rename the error to "handlers still running". Also stop using `ExpiringGroups` as the handler counter.
4. **Put concatenation in one module:** `ConcatReference`, `concatInfo`, `concatOf`, `udhLength`, and the UDH build in `splitMessage`.
5. **Group `src/` into 4–5 folders:** handles, link, codec, message, receipts. The flat 37 files is the main Shape cost.
6. **Extract the emitter guard.** The `emit` override, `captureRejectionSymbol` and 7 `declare` lines are copied three times (Session, SmppClient, SmppServer).

## What the structure gets right

- Narrow seams: `SessionPort`, `SmsDeps`, `SendSmsDeps`, and the `ReconnectLoopOptions` callbacks. Collaborators do not reach into the Session.
- Every unit is small and single-noun (`SendWindow`, `PendingRequests`, `LinkTimers`, `PduFramer`).
- `Result` is used everywhere, so control flow reads top-down.
- Comments carry spec sections and the peer quirks behind them (Jasmin, CM.com, Kaleyra).
- `defaults.ts` is the single source of numbers.
- `LinkLostError` vs `UnansweredError` encodes goal 2 in the type.

## The 3am question

**Time to the right unit, cold: about 5–10 minutes, three hops.**
- Hop 1: grep "drain" lands in `session.ts:291`, `Session.drain`.
- Hop 2: that calls `this.incoming.drain(timeout, signal)` at `incoming-requests.ts:146`.
- Hop 3: that calls `RunningHandlers.idle` (`running-handlers.ts:63`), and I had to find where `start()` and `done()` are called: `IncomingRequests.handOver`, `incoming-requests.ts:311-314`.

**The answer:** `done()` fires when the `onSms` handler *returns*, not when `sms.sendResp()` is called. `sendResp` (`sms.ts:126`) never touches `RunningHandlers`. So a handler that answers early and keeps working holds the drain until `shutdownTimeout`. That includes a handler awaiting `sendDlr()` to a slow peer: `sendDlr` goes through `port.request`, which bypasses the stopping check, and the outgoing drain then waits on it too.

- **Is it a bug?** README line 399 documents "Wait … for every onSms handler still running", so it is by design. The `sendResp` docstring ("for a handler that keeps working after the answer") invites exactly this expectation.
- **Right file and unit:** `incoming-requests.ts`, `handOver`, together with `running-handlers.ts`.
- **What slows the hunt:** the reported error, "message(s) unanswered", is false for this peer and costs an extra detour into `sms.ts`.

**Where it rots first:** `IncomingRequests.onMessage` / `handOver`. Every new inbound rule lands there (per-PDU rate limiting, the store for half-reassembled messages, new `data_sm` semantics), and each one adds another `port.closed()` check and another answer path.

**Where the next two features would land**
- **Goal 9's store** would land across `Reassembler`, `DlrMerger` and `ExpiringGroups`. `ExpiringGroups` is the obvious seam, but it is shared with the handler counter, which must not be persisted. Separate them first.
- **A per-PDU rate limit (goal 7)** would land in `OutgoingRequests.request` beside `SendWindow`. That is a clean place. The inbound side would land in `IncomingRequests` again.

## Hardest places, ranked

1. `src/incoming-requests.ts:260-326`, `IncomingRequests.onMessage` / `handOver`. Bound refusal, reassembly, answer-on-arrival, the handler run, and refusal-or-loss are interleaved with `closed()` checks and `sms.sendResp` side effects.
2. `src/reassembly.ts:179-198`, `Reassembler.weighed` / `dropped`. The transient `weighing` field is read inside an `onDrop` callback to discount the newest segment. That is action at a distance through a callback.
3. `src/session.ts:291-310` with `incoming-requests.ts:146` and `running-handlers.ts:50-75`, `Session.drain`. It orders handlers, then requests, on a shared deadline (`timeout` for the first, `leftOf(deadline)` for the second), then checks `closed`. The meaning of "unanswered" is wrong.
4. `src/expiring-groups.ts:111-122`, `ExpiringGroups.expire`. It fires `onDrop` mid-iteration. `RunningHandlers.onDrop` → `settle()` → `size` → `expire()` re-enters it.
5. `src/reconnect-loop.ts:64-153` with `client.ts:143-156`, `ReconnectLoop.adopt` / `attempt` / `down` / `stop` and the client `send` retry loop on `LinkLostError`. The state lives in `session`, `timer`, `attempting`, `stopped`, `upAt` and `links`.
6. `src/pdu.ts:84-136`, `resolveShortMessage` / `resolveBody`. The rules for which of `short_message` or `message_payload` owns `data_coding`.
7. `src/sms.ts:126-231`, `sendResp` / `sendDlr` over the shared mutable `Answer` object.

**The unit I would least want to modify:** `IncomingRequests`, `src/incoming-requests.ts:87-358`.

## Scores

Intrinsic difficulty, which earns no bonus: moderately high. It is an async request/response protocol with reassembly, reconnect, a drain and two ends of the link.

- **Navigation 7.** Sits at "Predictable". File names map to concepts well enough that the 3am path took three hops. It is held below 8 by the flat 37-file `src/` and by the drain's "unanswered" error text pointing at `sendResp`.
- **Locality 6.** Between 5 and 7. The narrow ports (`SessionPort`, `SmsDeps`) keep collaborators apart. Hidden coupling holds it down: `RunningHandlers` evicting live handlers unless `refusedAtBound` runs first, the reassembler's `weighing` side channel, and the drain's ordering and shared deadline.
- **Shape 6.** Between 5 and 7. Units are small and mostly honest. Held down by the flat `src/` with no visible areas, `session-options.ts` as a grab bag, concatenation spread over three files, and the overloaded refuse/end/answer/closed vocabulary.
- **Self-sufficiency 7.** Sits at "Predictable". Most units state their invariant and cite the SMPP section at the site (`message.ts:13`, `pdu.ts:166`, `sms-id.ts:58`). Held below 8 because the area map and the import direction exist only in the AGENTS.md architecture block, not in the layout.
- **Overall 6.** Capped at 7 by the lowest dimension plus one. It sits at 6 because the unit that grows, `IncomingRequests`, is the hardest one to change safely.

SCORES nav=7 loc=6 shape=6 self=7 overall=6
