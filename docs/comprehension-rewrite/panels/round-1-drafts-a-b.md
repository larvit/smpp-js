# Round 1: drafts A and B

## Draft A, junior seat

1. **Hardest places, ranked**

   1. `src/outgoing-requests.ts:75-113` (`OutgoingRequests.request` / `requestDuringDrain` / `carrier`) together with `src/session.ts:336-371` (`linkLost`, `end`, `nextLinkExpected`). Whether a send is refused, waits or retries depends on `life`, `link.canCarry()` and `reconnectLoop`. Those live in `Session` and reach here only through the three `LinkView` closures, so reading one file means holding the other's state in my head. Line 82, `closing() && current().canCarry()`, beat me until I traced `carrier()` → `nextExpected()` → `life === 'open'`. Its comment ("refused as closed further on") points at the answer without giving it. `linkLost` reads `nextLinkExpected()` before `close()`, and only the comment explains why. That comment helped; the rest stayed half-opaque.
   2. `src/held-messages.ts:40-170` (`HeldMessage`, `HeldMessages.offer`), with `src/sms.ts:77-162` and `src/session.ts:104`. A message has six exits across three files: a `working` listener counter, `answered()` deferring by `setImmediate`, a `WeakMap` from `Sms` to hold, and `emit()` returning false meaning release. `captureRejectionSymbol` calls `this.link.held.rejected(...)`, which is always the current link, so the message is only found if the link has not been replaced since the emit. The numbered exit list in the doc comment is the only reason I followed this.
   3. `src/pdu.ts:84-136` (`resolveShortMessage`, `resolveBody`). The `CodingSource` idea is hard: `data_coding` is rewritten from whichever body "owns" it, an empty buffer counts as `message_payload`, and a string gets encoded while a Buffer does not. That is four branches at once. The read side has a hidden coupling too: at `pdu.ts:249` `readParams` passes the already-read `sm_length` to every wire type's `read`. Only the comment at `defs/commands.ts:19-23` hints at it. Partly resolved.
   4. `src/defs/encodings.ts:147-190` (`messageClassOf`, `messageClassEncoding`, `encodingByDataCoding`). Bit masks over GSM 03.38 coding groups, and I have no domain background for them. `ASCII` means GSM 03.38 7-bit, a name that lies; only the README encoding table fixed that for me. The `//` comment at 159-160 sits above the JSDoc of the function it describes, so it reads as floating. Stayed opaque at bit level.
   5. `src/dlr.ts:157-239` (`messageType`, `receiptStatus`, `dlrFromPdu`). There are four message types, TLV-over-body precedence for both id and state, and an `unmarked` case that needs both an id and a status to count as a receipt. Comments cite spec sections I can't check. It reads correctly, but only after two passes.
   6. `src/reassembly.ts:187-207` (`Reassembler.trim`) with `src/expiring-groups.ts:18,70-88`. `weigh()` may evict the very group being added, and `answered = parts.size - 1` subtracts the refused segment. The contract "enforces neither max nor timeout itself; only weigh() evicts" splits enforcement between owner and store. Resolved by the comments, but costly.
   7. `src/dlr-merger.ts:150-172` (`open`, `close`). `close()` does not close a group: it moves the base into a second `ExpiringGroups` called `spent`. The misleading name cost me a reread. The class doc resolved it.
   8. `src/drain.ts:20-56` (`drain`, `leftOf`, `messagesBudget`). The doc says "one budget", but messages get their own budget with a fallback while requests get what is left. 0 means "forever", so `leftOf` clamps to 1. Small but inverted.

2. **Least want to modify:** `HeldMessages` / `HeldMessage` (`src/held-messages.ts`). Its lifetime is decided by timing (`setImmediate` so that `sendDlr` still goes out past a drain), by listener counts, by identity checks against reused sequence numbers, and by callers in `session.ts` and `sms.ts`. A change to any exit risks a drain that hangs or one that ends early, and nothing local would show it.

3. **Expected hard, found easy:** `PduFramer`, `PendingRequests`, `SendWindow`, `ReconnectLoop`, and the TLV table's type-level keying (`defs/tlvs.ts`). `defs/types.ts` is 684 lines but repetitive and uniform. `client.ts` and `server.ts` are shallow and read top-down.

4. **Prose debt:**
   - Needed:
     - The README encoding table, to learn that `ASCII` means GSM 7-bit.
     - The AGENTS "GSM 7-bit is sent unpacked" section, to see why `segmentUnits` holds 153 against 134.
     - The README "Server in depth" and "Shutdown" sections, to understand `answeredOnArrival` and what the drain waits for.

     Finding them meant scanning a 773-line README; AGENTS has no anchors from code to sections.
     - The decisions index in AGENTS gives titles only. The reasoning is in `docs/decisions.md`, which I was not allowed to read, so rules like "a drain ignores `shutdownTimeout: 0`" had to be recovered from code comments.
   - Told me nothing the code did not:
     - The 0.4.0 defect table, which says nothing about the current code.
     - Most of the AGENTS architecture list, which restates filenames.
     - Most decision-index lines, which repeat what an adjacent code comment already says.
     - One-liners such as "Sends a request and resolves with the peer's response" on `send()`.

   I opened no tests.

5. **Scores.** The problem is intrinsically hard (a protocol I don't know, plus async link lifecycles); that gets no bonus below.
   - **Navigation 7 (Predictable):** file names match behaviours one-to-one, but "what happens to a send during shutdown" lives across `session.ts`, `outgoing-requests.ts`, `link.ts` and `drain.ts`, with no single entry point.
   - **Locality 5 (Honest middle):** `Session` injects its state as closures (`LinkView`, `Link.on`) and passes itself back into `HeldMessages` and `IncomingRequests`, and correctness hangs on ordering that is only named in comments (`linkLost` before `close`, `setImmediate` in `answered`).
   - **Shape 6 (between 5 and 7):** fan-out stays bounded per level, but several names lie: `ASCII` for GSM, `DlrMerger.close` for "mark spent", `string` for a length-prefixed Octet String next to `cstring`, and `answered()` meaning "release a turn later".
   - **Self-sufficiency 6 (between 5 and 7):** dense, spec-citing comments carry most units, but the domain vocabulary (GSM alphabet naming, segment budgets, what `answeredOnArrival` means) needs the README open beside the code.
   - **Overall 6:** capped at locality plus one by the cross-file lifecycle state.

SCORES nav=7 loc=5 shape=6 self=6 overall=6

## Draft A, mid seat

1. **Hardest places, hardest first**

   1. `src/held-messages.ts:252-435`, `HeldMessage` / `HeldMessages` (and `session.ts:95-107`, the `captureRejectionSymbol` override). There are six exits, each in a different method. I had to trace this chain across files: a listener rejects, Node's `captureRejections` calls the session, the session calls `this.link.held.rejected(rest[0])`, a WeakMap is searched by object identity, `listenerGaveUp()` counts down from a `listenerCount('sms')` taken when the message was offered, `answered()` waits a turn in `setImmediate`, `release()` compares the array by identity, `settle()` runs, and finally `IdleWaiters` wakes the drain in `drain.ts`. The comment listing the six exits made it readable. What stayed unclear: why the rejection goes to the *current* link's store, which may not be the link the message arrived on after a reconnect. I also had to work out that `send()` choosing `sendPastDrain` exists only because `OutgoingRequests.request` refuses sends while closing.
   2. `src/outgoing-requests.ts:510-613`, `request` / `requestDuringDrain` / `bindOnCurrentLink` / `requestOnCurrentLink` / `carrier`. That is four ways onto the wire, and each skips a different check. Line 517 (`closing() && current().canCarry()`) refuses only when a link is up. The comment "refused as closed further on" meant tracing `carrier()` to see that `nextExpected()` is false while closing. `responseTimeout` is reused as the deadline for waiting on a link, `deadline === 0` means forever, and the retry loop depends on `retryOnNextLink` from `Link.send`. The `LinkView` closures read `Session` private state from a distance. The comments resolved most of it after two reads.
   3. `src/session.ts:208-366`, `unbind` / `drain` / `comeBackUp` / `linkLost` / `end`. The ordering does the work. `unbind` drains, then goes around the closing refusal via `requestOnCurrentLink`. `closedOnUnbind` decides which error wins. `comeBackUp` sets `this.link` before the bind succeeds, and `linkLost` must read `nextLinkExpected()` before `close()` because a listener may re-enter. The inline comments ("Read before close()…", "close() can land while…") resolved it, but I had to hold five states at once.
   4. `src/reassembly.ts:187-207`, `Reassembler.trim`, with `src/expiring-groups.ts:245-315`, `ExpiringGroups.weigh`. `ExpiringGroups` applies its three limits differently: the owner checks `full`, the owner calls `takeExpired`, and only `weigh` evicts. Map insertion order stands in for age, and `set()` re-inserts, so a replaced entry becomes the newest. `trim` can evict its own group, and it then counts `size - 1` as lost because the refused segment "stays with the peer". The comments state each rule, but checking the arithmetic took three rereads.
   5. `src/pdu.ts:84-136`, `resolveShortMessage` / `resolveBody`, plus `pdu.ts:249`. `CodingSource` decides whether `short_message` or `message_payload` is allowed to set `data_coding`, and an empty buffer flips the answer. `readParams` passes `sm_length` as the length argument to *every* field read, and only `buffer.read` uses it. That is a hidden coupling that neither line mentions. With no SMPP background this stayed half-opaque.
   6. `src/defs/encodings.ts:1,105-190`, `EncodingName` and `messageClassEncoding` / `encodingByDataCoding`. The name `'ASCII'` means GSM 03.38, and nothing says so until `dataCodingByEncoding`'s comment. It also misleads in `message.ts:343` and `message.ts:402` (`resolved === 'ASCII'` means septet packing). The bit masks (`0x80`, `0xF0`, bits 3-2) were an algorithm I had no context for. Two comments sit stacked in reverse order at lines 159-161. The charter's "GSM 7-bit is sent unpacked" section explained the 153.
   7. `src/dlr.ts:357-439`, `messageType` / `receiptStatus` / `dlrFromPdu`. There are four message types, and `'unmarked'` becomes a receipt only if both an id and a state can be scraped. Otherwise `IncomingRequests.onDelivery` (`incoming-requests.ts:152`) quietly reroutes it to `onMessage`. The rule is local and commented, but it only makes sense with the spec's `esm_class` bits in mind.
   8. `src/client.ts:258-330`, `keepTrying` / `initialAttempts`. There is a second `ReconnectLoop` outside the session, a fresh `Session` per attempt, and a `lastErr` captured in closures. The code itself is clear; the cost was noticing that there are two loops.

2. **Unit I would least want to modify:** `HeldMessages` / `HeldMessage` (`src/held-messages.ts`). Its correctness depends on timing (`setImmediate`), a listener count taken at `emit` time, identity lookups (the WeakMap, and array identity in the store), and callers in `session.ts`, `incoming-requests.ts`, `sms.ts` and `drain.ts` that each use a different exit. A change there fails as a hung or cut-short shutdown, which is hard to see in a test.

3. **Expected hard, found easy:** the wire codec. `defs/types.ts` is long but uniform. `PduFramer`, `parseTlvs` / `writeTlvs`, `readOptionalParams` (its NULL-pad rule is commented), `ReconnectLoop`, `bind-direction.ts`, `sms-id.ts` and the `Result<T>` convention were all quick. `udh.ts`'s `concatInfo` explains its walk over the header elements well enough for a newcomer to the domain.

4. **Prose debt**
   - **Needed:**
     - The AGENTS.md architecture map was cheap and correct; it is how I found every file. The file list matches `src/`.
     - The "GSM 7-bit is sent unpacked" section was necessary for `segmentUnits`.
     - The README's Receive-SMS text was necessary to see why `sendResp()` on a multipart message writes nothing.
     - Missing everywhere: a one-line glossary of ESME/SMSC, `esm_class`, `data_coding`, UDH and `sar_*`. The only one is the `LinkEnd` comment for ESME/SMSC. Comments cite spec sections ("SMPP 3.4 5.2.12") that I cannot open, so for someone new to the domain they are pointers, not definitions.
     - The decisions index names rules ("the drain's wait on the application ignores `shutdownTimeout: 0`") that I then found stated in the code (`drain.ts` `messagesBudget`). The index cost scrolling and gave nothing the code did not.
     - I opened no tests.
   - **Told me nothing new:**
     - The AGENTS "Defects found in 0.4.0" table: history, not needed to read this code.
     - Most of the Conventions paragraph on test fixtures, for reading `src/`.
     - Doc comments that restate the code: `Link.canCarry` ("Whether a request can go out on it right now"), `HeldMessages.isGone`, `Session.bindAllows` ("Consulted by the library's senders"), `IdleWaiters.settle`, `PduRefusedError`'s class comment.

5. **Scores**
   - **Navigation 7:** at the "predictable" anchor. The one-line-per-file map and concept-named files (`link.ts`, `drain.ts`, `reassembly.ts`) got me from symptom to file first try. It stops short of 9 because shutdown behaviour lives in five files (`session.ts`, `drain.ts`, `held-messages.ts`, `outgoing-requests.ts`, `idle-waiters.ts`).
   - **Locality 5:** at the "honest middle" anchor. Most modules stand alone, but the held-message/drain path runs on hidden timing (`setImmediate`), a listener count taken early, rejection routing to whatever link is current, and `LinkView` closures reading `Session` private state. The order-dependent sequences in `Session.linkLost` and `unbind` add to it.
   - **Shape 6:** between the middle and predictable anchors. Fan-out is bounded (`Session` → `Link` → `PendingRequests` / `HeldMessages` / `Reassembler`), but some names lie or clash:
     - `'ASCII'` means GSM 03.38.
     - In `sms.ts`, `answered` is both a mutable `{ smsId }` holder (line 81) and a handler function (line 69).
     - `HeldMessage.held.held` chains through two different things both called `held`.
     - `lostLink()` is a predicate named like an event.
     - There are four request entry points on `OutgoingRequests`.
   - **Self-sufficiency 6:** between the middle and predictable anchors. Comments are dense and carry the why at the call site (the six-exit list, "Read before close()"). But domain terms are never glossed and the spec section numbers point outside the repo, so the `data_coding` and `esm_class` bit logic in `encodings.ts` and `dlr.ts` cannot stand alone for a reader new to SMPP.
   - **Overall 6:** capped at locality + 1. The hard parts are few and mostly marked, but the one I would fear most (held messages and the drain) spreads across files and relies on timing.
   - **Intrinsic difficulty** (no bonus): moderate-high. The protocol has two segmentation spellings, receipts that share a command with messages, a direction-dependent `data_sm`, and graceful drain combined with reconnect.

SCORES nav=7 loc=5 shape=6 self=6 overall=6

## Draft A, senior seat

1. **Hardest places, ranked**

   1. **`src/held-messages.ts:40` `HeldMessage`, and `HeldMessages.offer` at `:148`.** Following this one flow meant holding five files at once:
      - `sms.ts:127` `sendResp` and `:210` `sendDlr`.
      - The `setImmediate` in `answered()` at `:58`.
      - `HeldMessage.send` at `:77`, which picks between `sendPastDrain` and `session.send` by asking `isHeld()`.
      - `OutgoingRequests.requestDuringDrain`.
      - `Session`'s `captureRejectionSymbol` at `session.ts:104`, which gets back to the hold through a `WeakMap` keyed on the `Sms`.

      A `sendDlr()` gets past a drain only while the release has not yet happened, and that is one event-loop turn. `working` is `listenerCount('sms')` taken at offer time, and the guarded `emit` returning false feeds exit 3. The six-exits comment and the README's Shutdown section settled it, but only after I had read both.

   2. **`src/outgoing-requests.ts:75` `request`, with `:90` `requestDuringDrain`, `:115` `bindOnCurrentLink`, `:133` `requestOnCurrentLink` and `:160` `carrier`.** There are four ways onto a link, and each skips a different mix of four things: the drain refusal, the send window, the wait for a link and the retry.
      - Line 94, `closing() && current().canCarry()`, only makes sense with the comment "refused as closed further on".
      - `misuse()` is checked twice.
      - Whether the bind and the unbind count toward the drain's `window.idle()` has to be worked out from the fact that they skip `attemptOn`.

      I followed it in the end, but did not come away sure of the edge cases.

   3. **`src/session.ts:234` `answer`, with `incoming-requests.ts:85` and `sms.ts:127`.** `sendReturn` always writes to `this.link`, the current link. The rule that "an answer belongs to the link the message arrived on" is held by callers checking `link.isClosed()` or `lostLink()` before they call, in two separate places. `sendReturn` never enforces it. I had to hunt for this, and only the decision titles in AGENTS.md told me the rule exists.

   4. **`src/pdu.ts:84` `resolveShortMessage` / `:113` `resolveBody`.** `CodingSource` decides whether `short_message` or `message_payload` sets `data_coding`. I had to hold these cases at once:
      - Buffer or string or absent.
      - Empty or non-empty.
      - `data_coding` given or not.
      - An empty `short_message` that still makes `message_payload` the source.

      The type comment at `:74` helps. It still took two reads.

   5. **`src/reassembly.ts:111` `collect` / `:188` `trim`, on top of `expiring-groups.ts:18`.** `ExpiringGroups` enforces its limits unevenly:
      - `set()` never evicts and `weigh()` does.
      - `full` is only advisory.
      - `onSweep` must itself call `takeExpired()`.

      `trim` counts `parts.size - 1` because the segment was added before weighing and may be the one evicted. The comments state each quirk, but I needed all of them at the same time.

   6. **`src/session.ts:208` `unbind` and `:336` `linkLost`.** In `unbind`, the three booleans `wasOpen`, `closedOnUnbind` and `drained` decide which error wins. In `linkLost`, "read `nextLinkExpected` before `close()`" depends on `link.close()` calling `reassembler.clear()`, which emits `sessionError` synchronously to a listener that might call `close()`. That is state changed out of sight. The comment names the risk but not the path it takes.

   7. **`src/dlr-merger.ts:150` `open` / `:165` `close`.** Here `close` means "mark as spent", not "tear down", and `spent` is a second `ExpiringGroups<true>` with its own cap and eviction. The class comment explains the purpose, but the method name misleads.

   8. **`src/client.ts:286` `keepTrying` / `:263` `initialAttempts`.** There are two different `ReconnectLoop` owners: the session's loop, and a separate one that runs only for the first connect. There is also a `lastErr` closure and a comment about `unref: false`. It was readable once I saw that `fromStart` builds a fresh `Session` for every attempt.

2. **The unit I would least want to modify:** `OutgoingRequests` together with its callers `HeldMessage.send` and `Session.unbind`. Whether a send is refused, queued or bypassed depends on which of the four entry points was chosen, and those choices are made in three other files. A change to one bypass has no local test of whether the drain still counts it.

3. **Expected hard, found easy:**
   - The codec: `defs/types.ts` and the TLV read/write. It is mechanical and every read is range-checked.
   - UDH walking in `udh.ts`.
   - GSM encoding and `splitMessage`.
   - Parsing receipt dates.
   - `ReconnectLoop`'s backoff reset.

   These are local and commented at the right spots, with SMPP section references.

4. **Prose debt.**
   - **Needed:** the AGENTS.md architecture map (accurate, and my main way to navigate). The README "Session / Shutdown" and "Sends and the link" bullets, for the drain and held-message rules. The AGENTS decision-index titles, for why answers are tied to a link and why a close after our own `unbind` is clean. Cost was moderate: all of it in two files I had already read, but the "one turn later" rule for `sendDlr` is stated in full only in README step 1.

     A comment that is wrong: `SessionOptions.shutdownTimeout` says it bounds only "the requests already on the wire", but `drain.ts:25` also uses it for held messages.

     Defaults are scattered with no pointer between them:
     - A separate `defaults` object in each of `client.ts`, `server.ts` and `session-options.ts`.
     - `backoffDefaults` in `reconnect-loop.ts`.
     - `defaultMaxOctets` in `reassembly.ts`, which duplicates `maxHeldOctets`.

     Finding where the default for a given option lives took a search.
   - **Told me nothing about the current code:**
     - The AGENTS 0.4.0 defects table: history, and it never helped me read `src/`.
     - Most of AGENTS "Conventions", which is about test fixtures and teardown.
     - One-liners that restate the code, such as `/** Sends a request and resolves with the peer's response. */` and `/** Answers a request the peer sent us. */`, plus the `ConcatInfo`/`udhLength` comments.

   I did not open any test.

5. **Scores.** The problem is intrinsically hard: an SMPP session layer with reconnect, drain, windowing, reassembly and receipt merging. It gets no bonus here.
   - **Navigation 7** (anchor 7): the AGENTS file map answers "where does this live" accurately for every file. It is held below 8 because a symptom like "`sendDlr` refused during shutdown" lands across four files, and "which default" across three objects all called `defaults`.
   - **Locality 6** (between 5 and 7): the codec, defs, dlr and message modules are fully local. The session layer is not: `Session` passes itself into `IncomingRequests`, `HeldMessages` and `createSms`, the link-answer rule is enforced by callers, and the drain bypass depends on a `setImmediate` in another file.
   - **Shape 6** (between 5 and 7): fan-out is bounded and most names are true. Some are not:
     - `ASCII` means GSM 03.38.
     - `HeldMessages.full()` sweeps, logs and flips state.
     - `DlrMerger.close` means "mark as spent".
     - `Session.link` is documented as "the latest socket".

     Four near-identical send entry points on `OutgoingRequests` also cost this score.
   - **Self-sufficiency 7** (anchor 7): the why-comments sit where they are needed (the six exits, the read-before-close note, the SMPP section numbers). Only the drain and held-message semantics needed the README open beside the code.
   - **Overall 6:** capped at 7 by locality, and held at 6 because the part that is hardest to change safely, the session layer, is also where the cross-file coupling sits.

SCORES nav=7 loc=6 shape=6 self=7 overall=6

## Draft A, architect seat

**Comprehension panel report: Architect, inherited.** Target: `/tmp/claude-1000/-home-lilleman-code-smpp-js/fe9b6791-4543-5342-9fc7-efa1e22d8fc7/scratchpad/draft-a`

I read README.md, AGENTS.md in draft-a, and every non-test file under src/. I read `defs/` down to its exports and skimmed the rest of it for shape. I opened no test.

## 1. Map from README and the file tree only (verbatim)

```
Top-level areas I expect (7):
A. Entry/wiring — index.ts (public surface), client.ts (connect+bind+reconnect policy), server.ts (listener, auth, sessions set).
B. Session life — session.ts (the EventEmitter, lifecycle, close/unbind), session-options.ts (options + defaults + validation),
   bind-direction.ts (bind types, which end, what a bind allows), reconnect-loop.ts (backoff), link.ts (?? one socket? timers?),
   drain.ts (graceful-shutdown wait).
C. Requests out — outgoing-requests.ts (send path), pending-requests.ts (seqNr correlation + timeout),
   send-window.ts (maxOutstanding), unanswered-error.ts (the "may have been taken" error), idle-waiters.ts (?? something waits for zero).
D. Requests in / messages — incoming-requests.ts (dispatch of what the peer sends), sms.ts (the 'sms' handle, sendResp/sendDlr),
   held-messages.ts (the 1000-unanswered bound from README "Unanswered messages"), reassembly.ts + expiring-groups.ts
   (multipart store; expiring-groups probably shared), concat.ts + udh.ts (segment detection UDH vs sar_*),
   message-body.ts (short_message vs message_payload), message.ts (encode/split), send-sms.ts (sendSms composition),
   retained-pdu.ts (?? memory accounting per maxOctets).
E. Receipts — dlr.ts (parse), dlr-merger.ts (messageDlr), sms-id.ts (smsIdFormat notations, <base>-<n>).
F. Codec — pdu.ts, pdu-framer.ts, pdu-refusal.ts (PduRefusedError), defs/* (spec tables, wire types, encodings).
G. Plumbing — result.ts, log.ts, error-from.ts (?? error from unknown), uuid.ts.

Unclear by name: link.ts, idle-waiters.ts, retained-pdu.ts, error-from.ts; overlap suspected between drain.ts / idle-waiters.ts / held-messages.ts.
Expected but not visible: no keepalive/timer file (README's enquire_link + idleTimeout) — guess it's in link.ts or session.ts;
no socket/transport file; no store (goal 9) — README says it has not shipped, so absence is honest; interop-tests/ and benchmarks/ are outside src/test.
```

**Where the map was wrong, and what each correction cost:**
- **link.ts (medium).** I expected a socket plus its timers. `Link` also owns the `PendingRequests`, the `Reassembler` and the `HeldMessages`. So held messages and reassembly belong to one socket, not to the session. That changes how you reason about the drain after a reconnect, and I had to rebuild part of the model.
- **held-messages.ts (medium).** I expected a counter. It holds six exit paths, a WeakMap for listener rejections and a back-reference to `Session`. It also sends through a bypass path (`sendPastDrain`).
- **sms.ts (low to medium).** I expected only the inbound handle. It also builds outbound delivery receipts (`receiptText`, `receiptTlvs`, `collectReceipt`), while `dlr.ts` parses them. Writing and reading receipts are split across two files.
- **Smaller surprises (low).** `reassembly.ts` exports `decodeSegments`, which `sms.ts` uses to build `sms.message`. `message.ts` also holds `smppTime` and `smppDate`.
- **drain, idle-waiters, retained-pdu, error-from (cheap).** Each turned out as guessed. `drain.ts` is budget arithmetic only.
- **Keepalive (right).** The timers are in `link.ts` (`resetTimers`).

## 2. Fan-out level by level
- **L0, repo:** src/, test/, README, AGENTS. Trivial.
- **L1, src/: 35 files plus defs/, all flat. This is the worst level.** My map needed 7 areas, but the layout shows none of them, and the AGENTS.md architecture list is not grouped by area either. I had to hold about 36 names to sort them.
- **L2, defs/:** 7 files, all spec tables. Bounded.
- **L3, units:**
  - `session.ts`: about 20 members, but grouped, with a stated invariant ("every event about the life is emitted from one of these four").
  - `link.ts`: about 12 members.
  - `outgoing-requests.ts`: 4 public ways in (`request`, `requestDuringDrain`, `requestOnCurrentLink`, `bindOnCurrentLink`), the one level where the fan-out is too wide for the concept.
  - `defs/types.ts`: 684 lines, but a table of wire types, so it is wide without being hard.

## 3. Names
**Misleading:**
- **`idle`** means two things. `HeldMessages.idle()`, `SendWindow.idle()`, `OutgoingRequests.idle()` and `IdleWaiters` mean "wait until the count reaches zero". `idleTimeout` and "closing an idle peer" in link.ts mean the peer has gone silent.
- **`ExpiringGroups`** enforces neither its `max` nor its timeout (its own comment says owners must). `DlrMerger.spent` is an `ExpiringGroups<true>`, a set dressed as groups.
- **`EncodingName 'ASCII'`** means GSM 03.38. It is public, legacy and documented, but it is still a false name.
- **`lostLink()`** on `SmsHandlers` is a predicate named like an event.
- **`message.ts`** also holds `smppTime` and `smppDate`.

**One concept with two or more names:**
- **Answering a request has four spellings:** `sendReturn`, `pduReturn`, `Session.answer()` and `sendResp`.
- **Letting a send past the drain has two:** `sendPastDrain` and `requestDuringDrain`.
- **The socket has three:** link, `sock` and socket.
- **A delivery report has three:** receipt, dlr and report.
- **A segment has two:** part and segment.

**One name over two concepts:**
- **"held"** covers messages the application has not answered (`Link.held`), requests waiting for a link ("holding a request until a link is back", "sending what was held for a link"), and `HeldMessages.held`, the inner ExpiringGroups.
- **`drain`** is both `Session.drain()` (private) and `drain()` in drain.ts.
- **`defaults`** is three different objects: session-options.ts, client.ts and server.ts, with `systemId` in two of them.
- **`Waiter`/`waiting`** is defined separately in outgoing-requests.ts and send-window.ts with different meanings.
- **"refuse/refusal"** covers codec refusal (`PduRefusedError`), segment refusal (`Refusal 'full'|'unplaceable'`) and option refusal in send-sms.

## 4. What I would restructure, ranked
1. **Group src/ into about 5 directories:** codec/, link+session/, inbound messages/, outbound send/, receipts/, plus defs/. This is the only thing pushing L1 past its bound. AGENTS.md records "src/ stays flat" as a decision, and I would contest it: at 36 files, the map lives in AGENTS.md, not in the layout.
2. **Settle on one verb for answering a request.**
3. **Move receipt composition out of sms.ts** next to the parsing in dlr.ts. Merge `collectReceipt` (`sms.ts:188`) with `collectSent` (`send-sms.ts:274`); they are near-duplicates.
4. **Make `ExpiringGroups` enforce its own `max` and weight, or rename it to say the caps are advisory.** Today three owners each implement eviction differently: `Reassembler.open` plus `trim`, `DlrMerger.dropOldest` plus `spent`, and `HeldMessages.full()` with its own weight comparison.
5. **Rename the "wait until zero" methods** (`idle()` → `drained()`), and give "held" one meaning.
6. **Move `smppTime` and `smppDate` into their own module, and keep one `defaults`.**

**What the structure gets right:**
- `session.ts` is a readable orchestrator with a single exit for a link (`linkLost`) and a single end (`end`).
- `Link.close()` runs once and takes down everything tied to that socket.
- The Result discipline is uniform.
- The codec is pure and synchronous.
- Small modules with honest names: `pdu-framer`, `send-window`, `pending-requests`, `reconnect-loop`, `unanswered-error`.
- Log messages are static and prefixed with the unit (`'heldMessages - …'`, `'drain - …'`), so a log line leads straight to its unit. This is the strongest navigation aid in the code.
- Comments give the WHY, often with a spec section.

## 5. The 3am question
Symptom: during a graceful shutdown the session hangs until the shutdown timeout, even though the application called `sms.sendResp()` on every message.

**Cold time to the right unit: about 5 minutes.**
1. `Session.close` leads to `Session.drain` (`session.ts:251`).
2. That leads to `drain()` (`drain.ts:32`). Its err text and warn logs already say which half stalled: "messages unanswered" or "requests unfinished".
3. **Messages half:** `HeldMessages.idle` and `HeldMessages.release` (`held-messages.ts:185-222`), reached from `HeldMessage.answered()` (`held-messages.ts:57`).
   - The gate is `sms.ts:159`, `if (!failure) handlers.answered()`. If any `sendReturn` for the message fails, the message is never released. Two ways that happens: an `smsId` the latin1 codec refuses, or a failed write. It then stays held until the drain budget runs out (and the 5-minute sweep drops it after that). The application saw `err` from `sendResp()` and ignored it.
   - Release also works by object identity (`held.get(key) !== pduObjs`), so check that too.
4. **Requests half:** `sendDlr` goes past the drain through `requestDuringDrain` (`outgoing-requests.ts:90`). It holds a send-window slot until the peer answers the `deliver_sm`, so a peer that is itself shutting down leaves it until the deadline. That is the other likely cause, and nothing in the symptom rules it out.

**Where it rots first:** the triangle of `HeldMessage`, `HeldMessages`, `Sms` and `Session`.
- `Link` is handed a `session` through its options.
- `HeldMessages` emits `'sms'` on `Session`.
- A listener rejection comes back through `Session[captureRejectionSymbol]` into `this.link.held.rejected(rest[0])` (`session.ts:104`). That is the current link, not necessarily the one the message arrived on.
- Release depends on ordering: `setImmediate` in `answered()` exists so that a `sendDlr()` called straight after `sendResp()` still gets past the drain.
- The next fix here will add a seventh exit.

**Where the next two features would land:**
- **Goal 9, the store.** It lands on `ExpiringGroups`, the store its three owners share. That class is synchronous and in-memory, and each owner enforces part of its contract, so moving to an async store interface touches `DlrMerger`, `Reassembler` and `HeldMessages` at once. Expensive.
- **Goal 7, a per-PDU rate limit or a custom alphabet.**
  - A rate limit lands cleanly at `OutgoingRequests.attemptOn` (`outgoing-requests.ts:124`).
  - A custom alphabet runs into the closed `EncodingName` union. It spreads into `message.ts:14` (`segmentUnits`), `send-sms.ts:92` (`dataCodingFor`, with hard-coded 0x10/0x18), `defs/encodings.ts` and `bitCount`: 4 to 5 places.

## 6. Hardest places, ranked
1. `src/held-messages.ts:40-223`, `HeldMessage` and `HeldMessages`: six exits, release by identity, WeakMap for rejections, `setImmediate` release, back-reference to the session, the drain bypass.
2. `src/session.ts:95-107`, `[captureRejectionSymbol]`: a rejected `'sms'` listener reaches the held messages through an `unknown` argument on the current link. Action at a distance.
3. `src/outgoing-requests.ts:75-137`: `request`, `requestDuringDrain`, `bindOnCurrentLink` and `requestOnCurrentLink` are four ways in with different bypass rules. The condition `closing() && current().canCarry()` (line 82) reads inverted until you notice the fall-through.
4. `src/expiring-groups.ts:19-147`, `ExpiringGroups`: the contract is half-enforced, and each owner fills in the rest differently.
5. `src/dlr-merger.ts:68-184`, `DlrMerger`: `groups` plus `spent`, and `close()` always marks an id spent.
6. `src/drain.ts:20-57` with `src/session.ts:251`: budget arithmetic where 0 means forever and the messages half falls back to `responseTimeout`. `session-options.ts:63` documents `shutdownTimeout` as covering only the requests on the wire, a partial truth next to the code that owns the behaviour.
7. `src/client.ts:228-330`, `bindOn`, `initialAttempts` and `keepTrying`: a second `ReconnectLoop` outside `Session`, with a fresh session per attempt.
8. `src/pdu.ts:84-136`, `resolveShortMessage` and `resolveBody`: which body field gets to set `data_coding`.

**The unit I would least want to modify:** `HeldMessages` and `HeldMessage` in `src/held-messages.ts`.

**Intrinsic difficulty (no bonus):** high. An SMPP session layer with reconnect, a drain split into two budgets, sequence-number correlation that belongs to one link, reassembly under caps, and asynchronous lifecycle races. Most of the hard spots are hard because of this.

## 7. Scores
- **Navigation: 7.** At the "Predictable" anchor: honest file names plus unit-prefixed static log strings took the 3am symptom from `session.ts` to `drain.ts` to `held-messages.ts`/`sms.ts:159` with no detour. It stays below 9 because the flat 36-file src/ makes you consult AGENTS.md's list to find areas.
- **Locality: 6.** Between the anchors: `Link` and `Session` hold clean boundaries, but the held-message flow reaches back into `Session` through `Link` options, relies on `setImmediate` ordering, and gets rejections through `captureRejections` on the current link. And three owners each re-enforce `ExpiringGroups`' caps.
- **Shape: 6.** Between the anchors: the flat L1 of 36 files breaks the bound and has no grouping. "held", "idle", `defaults` and "drain" each name two things, and a response has four verbs. The files are small and single-purpose.
- **Self-sufficiency: 7.** At the "Predictable" anchor: invariants are stated at the code (the six-exits list, the `linkLost` comment, spec citations), and I needed no second document to follow a unit. It stays below 9 because of the partial `shutdownTimeout` doc at `session-options.ts:63` and the drain semantics, which only README fully states.
- **Overall: 6.** Held to the Locality and Shape 6s. It reads close to "Predictable": a cold senior would be productive within a week and would know to fear `held-messages.ts`.

SCORES nav=7 loc=6 shape=6 self=7 overall=6

## Draft B, junior seat

1. **Hardest places, ranked hardest first**

   1. **`src/outgoing-requests.ts:70-168`, `OutgoingRequests.request` → `requestPastDrain` → `carry` → `attempt`.** A request has four ways in. One is a recursive retry (`carry` calls itself at :130) that fires only when `retryOnNextLink && link.awaitsNextLink()`. Each hop asks `LinkLife` a different question: `isStopping`, `canCarry`, `refusal`, `budget`, `awaitsNextLink`. I had to keep LinkLife's phase table open to follow it. The guard at :77, `isStopping() && canCarry()`, has the comment "With no link, the request is refused as closed further on". That describes the branch that is *not* taken here, and I read it three times. `requestPastDrain` is named for the caller that needs it (a receipt during a drain), not for what it does. The `UnansweredError` wrap at :167 was clear. The rest stayed half-opaque.
   2. **`src/link-life.ts:74-171`, `LinkLife.transition` / `lose` / `end`.** There are three pieces of state: `linkPhase`, `stopping` and `drops`. `stopping` is set in two places (:89, :167). `drops` increments both in `lose` and in `end`, and `bound` while stopping falls through to `lose()`. The effects returned are carried out elsewhere, in `session.ts:269` `run()`, so behaviour is split across two files in an order I had to trust. The type comments at :13-33 made it tractable. What really cost me was the initial phase at :60: `linkPhase = 'up'` on a socket that has not bound yet. That contradicts the `up` doc ("a bound socket carries requests") and the charter's "a bind is what makes it one". I never resolved why the first link starts `up`.
   3. **`src/held-messages.ts:40-181`, `HeldMessages`.** The numbered "six ways a hold ends" comment helps, but the ways live in three files. Way 2 enters from `session.ts:97`, where `captureRejectionSymbol` passes `rest[0]` as `unknown`. It is then looked up in a `WeakMap`, and `working` is seeded from `session.listenerCount('sms')` at :161. Way 1 arrives through a callback built in `sms.ts`. Way 3 depends on `emit` returning false, both for no listener and for a throw (the override in `session.ts:78`). I pieced this together; it did not stay opaque, but it was the most action at a distance in the codebase.
   4. **`src/pdu.ts:84-136`, `resolveShortMessage` / `resolveBody`.** `CodingSource` decides which of two fields may set `data_coding`. An empty buffer counts as `message_payload`, and `sm_length` is filled only sometimes. With no SMPP background I could not tell why an empty `short_message` hands authority to the TLV until I read `message-body.ts` and the README's "Where the body is". After that it made sense, but it took two files and a doc.
   5. **`src/client.ts:228-350`, `bindOn` / `initialAttempts` / `keepTrying` / `client`.** The `fromStart` path builds a second `ReconnectLoop` outside any session. Each attempt gets a fresh `Session`, and a `lastErr` closure is shared between two lambdas. The comment at :249, "close() must reach the loop's stop() before its first await", states an ordering invariant that lives in `session.ts` `drain()`/`apply('stopping')`. It is correct, but invisible from here.
   6. **`src/defs/encodings.ts:151-198`, `messageClassOf` / `messageClassEncoding` / `encodingByDataCoding`.** This is bit-masking over `data_coding` groups I had no context for. The `//` comment sits above the `/** */` block at :159-161, so it reads as belonging to the wrong function. The "ASCII" name meaning GSM 03.38 is a lie I only caught because the README's encoding table says so. It stayed partly opaque: I trust it, but I could not verify it.
   7. **`src/reassembly.ts:188-207`, `Reassembler.trim`.** `ExpiringGroups.weigh()` returns evicted groups, possibly including the current one. `answered = parts.size - 1` for the current group depends on the refused segment already being in `parts`. The comments at :200 and :125 resolved it after a reread.
   8. **`src/drain.ts:70-112`, `drain` / `answeringBudget`.** Two budgets with different zero-semantics, a fallback to `defaults.responseTimeout` imported from `session-options`, and a `setImmediate` turn. The comments explain each step. It was harder than it looked, but it resolved.

2. **The unit I would least want to modify:** `OutgoingRequests.carry` together with `requestPastDrain` (`src/outgoing-requests.ts:85-133`). Its correctness depends on LinkLife's phase at the exact moment of each await: whether a failed write has already produced `lost` → `dropLink`, so that `awaitsNextLink()` is true. It also depends on the send-window slot being released in `finally` before the recursion. Nothing in the unit states those timing assumptions. A change would be guessed and then tested.

3. **Expected to be hard, found easy.**
   - The wire codec: `defs/types.ts` is long but completely regular, and every read/write is range-checked.
   - `PduFramer`, `concatInfo`, `sms-id.ts`, `dlr.ts` receipt parsing (comments name the operators and spec sections).
   - The `Result` pattern.
   - `server.ts` `handleRequest`.
   - `DlrMerger`, whose severity table comment says exactly why it exists.
   - The session constructor, which reads as a wiring diagram.

4. **Prose debt.**
   - **Needed:**
     - The SMPP vocabulary: ESME vs SMSC, `deliver_sm` vs `submit_sm` direction, `esm_class`, `data_coding`, TON/NPI, UDH vs `sar_*`. Only the README supplies it, scattered across "Receiving in depth", "Bind direction" and "Delivery receipts". There is no glossary, and finding each term cost several searches.
     - The charter's "GSM 7-bit is sent unpacked" section, to understand `segmentUnits` in `message.ts:14`. Cheap, because the architecture map pointed there.
     - The AGENTS decision index. Its lines, for example "One owner decides whether a link can carry a request", told me a rule exists but not its reasoning. I was not allowed to open `docs/decisions.md`, and the initial-`up` puzzle is exactly where I needed it.
   - **Told me nothing:**
     - The 0.4.0 defect table. It is history, and useless for reading the current code.
     - The long test-fixture paragraph in Conventions.
     - Duplicated doc comments: `deliver` "False means nothing was" appears in both `outgoing-requests.ts` and `pending-requests.ts`, and the `idle()` "Resolves 0 once…" wording is repeated four times.
     - `/** Injected so expiry can be exercised without a wall clock. */` repeated on four option types.
     - `get sock` "Replaced on reconnect" in `session.ts`, which restates `PduTransport`.

5. **Scores.** The problem itself is hard (async link lifecycle, reconnect, protocol quirks); that gets no bonus below.
   - **Navigation: 7.** At the "predictable" anchor: the AGENTS architecture map names every file by its question and the filenames match. It stops short of 9 because a behaviour like "a send during shutdown" spans `outgoing-requests.ts`, `link-life.ts`, `drain.ts` and `session.ts`, with no single landing file.
   - **Locality: 6.** Between the middle and predictable anchors. The collaborators are cleanly split, but LinkLife's `stopping`/phase flags are read by OutgoingRequests at await boundaries, effects run in a different file from where they are decided, and HeldMessages is entered from the EventEmitter's `captureRejectionSymbol`. All of that is action at a distance.
   - **Shape: 6.** Fan-out is bounded (Session has about 9 collaborators, each small), but some names lie: `ASCII` means GSM 03.38, `drain.ts` houses `IdleWaiters`, `requestPastDrain` is named for a caller, and the link starts in phase `up` before any bind.
   - **Self-sufficiency: 5.** At the middle anchor. Comments are dense with spec citations and explain the WHY locally. Still, a reader without the domain needs README open for SMPP terms, and some rules exist only as index lines pointing at a decisions file.
   - **Overall: 6.** Capped at 6 by self-sufficiency. The layout is good and the hard parts are really hard, but three of them (sections 1.1-1.3) need two or three files open at once.

SCORES nav=7 loc=6 shape=6 self=5 overall=6

## Draft B, mid seat

1. **Hardest places, hardest first**

   1. **`src/link-life.ts:74` `LinkLife.transition()`, with `lose()` :148, `end()` :159, and `src/session.ts:263` `apply()` / :269 `run()`.** The table depends on two hidden variables besides the phase: the `stopping` flag and the `drops` counter. `lose()` sets the phase to `down` before it calls `end()`, and that is the only thing that stops `end()` counting the same drop twice. `'bound'` while stopping goes through `lose()` and ends up in `end()`. The effect order matters: `dropLink` clears held, incoming and outgoing before `emitClose`. The phase names mislead too. The doc at :14 says "`up`: a bound socket carries requests", but the phase starts as `up` (:60) on a socket nothing has bound yet, both on a server session and on a client before its bind. I only resolved that after reading `OutgoingRequests.requestPastDrain` (outgoing-requests.ts:85), where the bind path skips the link check. The table's JSDoc helps. The transitions themselves I had to trace by hand.
   2. **Shutdown, spread over `src/session.ts:237` `unbind()` / :300 `drain()`, `src/drain.ts:96` `drain()` / :70 `answeringBudget()`, `src/outgoing-requests.ts:70` `request()` / :85 `requestPastDrain()`, and `src/held-messages.ts` `sendReceipt`.** To know whether a send is refused I had to hold five things at once: `isStopping() && canCarry()`, the "refused as closed further on" path through `LinkLife.refusal()`, the receipt's route past the drain, the `setImmediate` turn between the two waits, and the fallback for `shutdownTimeout: 0`. `IdleWaiters` lives in `drain.ts` but serves `SendWindow` and `HeldMessages`, so I went to the wrong file for it once. The comments explain each step, but no single place explains the whole sequence.
   3. **`src/held-messages.ts:94` `offer()` / :117 `listenerRejected()` / :154 `keep()`.** Release path 3 depends on `Session.emit` being overridden (session.ts:78) to return `false` when a listener throws. Path 2 depends on `captureRejections` routing through session.ts:106 back into a `WeakMap` lookup by object identity. The `working` count is taken from `session.listenerCount('sms')` at keep time. That is action at a distance in both directions. The numbered "six ways" comment is what made it followable.
   4. **`src/client.ts:228` `bindOn()`, :263 `initialAttempts()`, :286 `keepTrying()`.** These are three layers of session creation for `fromStart`, with abort listeners added and removed at different points. The comment at :249 says `close()` has to reach `stop()` before its first await. That rule depends on `Session.drain()` calling `apply('stopping')` synchronously (session.ts:301). The comment resolved it, but it is an ordering dependency across files.
   5. **`src/pdu.ts:84` `resolveShortMessage()` / :113 `resolveBody()`.** The `CodingSource` idea (which of the two bodies gets to set `data_coding`) has about six branches: empty buffer, non-empty buffer, a string that encodes to empty, the command having no `short_message`, and a string `message_payload`. I had no domain background for why the payload may override `data_coding` only when `short_message` is empty. The type comment at :74 got me about half of it.
   6. **`src/reassembly.ts:188` `trim()` with `src/expiring-groups.ts:70` `weigh()`.** `weigh()` returns evicted groups, possibly including the current one, and `trim` then uses `parts.size - 1` for that one. `ExpiringGroups` enforces its limits unevenly: `max` never, `maxWeight` only in `weigh`. Its three users each handle that differently: `HeldMessages` checks the weight itself, and `DlrMerger` runs two instances (`groups` + `spent`, dlr-merger.ts:150/:165). The class comment says all this, but I needed a second pass.
   7. **`src/defs/encodings.ts:162` `messageClassEncoding()` / :182 `encodingByDataCoding()` / :151 `messageClassOf()`.** This is bit arithmetic over GSM 03.38 coding groups, which I have never seen. The comments cite the spec but I can't check them. It stayed partly opaque, but it is small and self-contained.
   8. **`src/outgoing-requests.ts:114` `carry()` / :141 `attempt()`.** A recursive retry that shares one link budget, where a retry happens only when `retryOnNextLink && awaitsNextLink()`. Inside `carry()`, `const held = await waitForLink()` reuses the word "held", which elsewhere means `HeldMessages`. Readable once you know the link model.

2. **Least want to modify:** `LinkLife.transition()` together with `Session.run()`. Every lifecycle path goes through it (idle timeout, socket close, unreadable stream, unbind, close, rebind). The order of effects and the `stopping`/`drops` side state are invariants that nothing in the types enforces. A wrong effect order would show up as a leaked pending request or a double `close` event somewhere far away.

3. **Expected hard, found easy:** the wire codec. `defs/types.ts`, TLV read/write and `PduFramer` are mechanical, range-checked and uniform. The same goes for `PendingRequests`, `SendWindow`, `ReconnectLoop`, the linear check chain in `send-sms.ts`, and `udh.ts`. Receipt parsing in `dlr.ts` was clearer than I expected for an unfamiliar domain.

4. **Prose debt**
   - **Needed, and cheap to find:**
     - The charter's architecture list. It is accurate and maps one file to one question.
     - The "GSM 7-bit is sent unpacked" section, needed for the 153/134 figures in `message.ts:129`.
     - README "Bind direction" and "Receiving in depth", needed for the `data_sm` direction and for multipart being answered on arrival.
     - README "Shutdown", needed to see why the drain waits on messages at all.
   - **Needed, and costly:** nothing tells a newcomer what `esm_class`, `data_coding`, TON/NPI or `sar_*` are beyond scattered spec citations. I had to piece them together from the README and comments.
   - **Stale prose:** `SessionOptions.shutdownTimeout` (session-options.ts:63) says "How long a drain waits for the requests already on the wire. 0 waits forever". That omits the wait on messages and the rule that 0 does not wait forever for them, which is exactly what `drain.ts` implements.
   - **Told me nothing beyond the code:**
     - The charter's defect table (0.4.0 history, no help reading today's code).
     - The long test-fixture convention paragraph, for this read.
     - The decision index titles, which I can't expand, and several of which repeat nearby code comments.
     - `Injected so expiry can be exercised without a wall clock`, repeated in four option types.
     - The duplicated `deliver()` doc on `OutgoingRequests` and `PendingRequests`.
     - `/** Starts both timers over… */`-style restatements in `link-timers.ts`.

5. **Scores**
   - **Navigation: 8.** Above 7, below 9. The charter's per-file map and concept-named files took me straight to the right place almost every time. The detours were `IdleWaiters` living in `drain.ts`, and receipt-sending split between `sms.ts` and `OutgoingRequests.requestPastDrain`.
   - **Locality: 6.** Between 5 and 7. Collaborators are injected and the lifecycle effects are an explicit list. But `HeldMessages` and `IncomingRequests` call back into `Session` (`emit` override semantics, `listenerCount`, `close`), and correctness depends on synchronous ordering (`apply('stopping')` before the first await, the `setImmediate` in `drain`).
   - **Shape: 7.** The Session hub's fan-out is wide but flat (about 9 collaborators, each small). A few names lie: the `up` phase before any bind, the `ASCII` encoding meaning GSM 03.38, the word "held" reused in `carry()`, and two different `onConnected` signatures (a `Session` in `ReconnectOptions`, a `Socket` in `ReconnectLoopOptions`).
   - **Self-sufficiency: 7.** Comments give the why and the spec section at nearly every surprising line, so most units stand alone. The domain vocabulary (the `esm_class` and `data_coding` bit layouts) and the whole shutdown story needed the README beside the code.
   - **Overall: 6.** Held down by Locality. The hard part (link life plus the drain) is localized and marked, but it takes rereads. A mid-level reader takes about two days to feel safe in `session`, `link-life` and `held-messages`.
   - **Intrinsic difficulty:** high. An asynchronous protocol session with reconnect, a send window, reassembly and a graceful drain, on a domain the reader doesn't know. That earns no bonus here.

SCORES nav=8 loc=6 shape=7 self=7 overall=6

## Draft B, senior seat

1. **Hardest places, ranked hardest first**

   1. **The shutdown path**: `src/session.ts:237` (`unbind`), `:254` (`close`) and `:300` (`drain`); `src/drain.ts:96` (`drain`), `:70` (`answeringBudget`) and `:65` (`leftOf`); `src/outgoing-requests.ts:70` (`request`).
      - To answer "what does a send do during shutdown?" I had to hold four files at once. `LinkLife.stopping` is set by `apply('stopping')`. `request()` refuses only when `isStopping() && canCarry()`. Otherwise it relies on `awaitsNextLink()` going false because `retrying()` checks `!stopping`, which I had to hunt for in `link-life.ts:132`.
      - The two drain budgets differ in a way only the code shows. Messages fall back to `responseTimeout`; requests get `leftOf(deadline)`, clamped to at least 1 ms. There is also an ordering dependency on a `setImmediate` turn between the two waits (`drain.ts:108`).
      - The comments are correct but terse. I resolved it after two reads, plus the README "Shutdown" section.
   2. **The held-message lifecycle**: `src/held-messages.ts:94` (`offer`), `:117` (`listenerRejected`) and `:154` (`keep`); `src/session.ts:106`; `src/sms.ts:91-93` and `:151-161`.
      - A hold ends in six ways, and they are spread across three files. `Session`'s `captureRejectionSymbol` reaches into `held` by identity, through a `WeakMap`. `working` is a snapshot of `listenerCount('sms')` taken when the message is kept.
      - The numbered "1–6" comments are what resolved it. Without them this was action at a distance.
   3. **The link state machine**: `src/link-life.ts:74` (`transition`), `:148` (`lose`) and `:159` (`end`).
      - `lose()` sets `down` and then calls `end()`, which rereads `attached()` (now false). `drops` is incremented in two places.
      - The initial `linkPhase = 'up'` (`:60`) contradicts the type doc at `:13-17`, which says `up` means "a bound socket carries requests". A fresh client or server socket is `up` before any bind.
      - Session's `bound()` (records the bind) and LinkLife's `'bound'` event (a rebind was answered) share a name and mean different things. This stayed partly opaque until I traced `comeBackUp` (`session.ts:359`).
   4. **Reassembly under the octet cap**: `src/reassembly.ts:111` (`collect`) and `:188` (`trim`), with `src/expiring-groups.ts:70` (`weigh`).
      - The segment is inserted before `trim`. `weigh` can evict the current group itself, and `answered = parts.size - 1` then excludes the refused segment from the loss.
      - `ExpiringGroups` enforces max, timeout and weight differently: `full` is only a flag, `weigh` evicts, `set` never does. Its own doc comments make that explicit, which resolved it.
   5. **Encoding a body under `data_coding`**: `src/pdu.ts:84` (`resolveShortMessage`) and `:113` (`resolveBody`).
      - `CodingSource` decides whether `short_message` or `message_payload` may overwrite `data_coding`. An empty encoded buffer flips the source to `message_payload`, and a Buffer `short_message` of length 0 does the same.
      - I needed the decision titles in the charter to see why. The branches are stateful rather than hard, but I reread them three times.
   6. **The client's first connect**: `src/client.ts:333` (`client`), `:286` (`keepTrying`), `:263` (`initialAttempts`) and `:228` (`bindOn`).
      - There are two `ReconnectLoop`s: one outside any session for `fromStart`, and one inside each session. Each attempt builds and discards a whole `Session`.
      - `bindOn` relies on `close()` reaching `stop()` before its first await (the comment at `:249`). That ordering invariant lives in `session.ts:300` (`drain` calling `apply('stopping')` synchronously).
      - The comment named the ordering rule; checking it held took a look at `session.ts`.
   7. **`DlrMerger.open`/`close`**: `src/dlr-merger.ts:150` and `:165`.
      - `close()` means "delete, then mark spent". It runs on completion, on expiry, on eviction and on a reused base, and the delete-then-set on `spent` is only there to refresh its deadline.
      - A second `ExpiringGroups<true>` used as a tombstone set is clever but not named as one. The class doc resolved it.
   8. **Server hook composition**: `src/server.ts:208` (`handleRequest`) with `src/incoming-requests.ts:89` (`handle`) and `:147` (`unhandled`).
      - What happens to a rebind or a pre-bind `unbind` is decided half in each file, through `false` return values. `boundAs === undefined` makes `bindAllows` return true.
      - I resolved it by reading both. A smaller cost of the same kind: `pdu.ts:249` passes `sm_length` as the `length` argument to every wire type's `read`, and only `buffer` uses it. That implicit coupling depends on wire order.

2. **The unit I would least want to modify: `OutgoingRequests`** (`src/outgoing-requests.ts:70-168`)
   - It has three entry points: `request`, `requestPastDrain` and `requestOnCurrentLink`. Each skips a different subset of checks (drain refusal, waiting for a link, the window).
   - Every sender in the library picks one of them by name: `enquire_link`, `sendSms`, receipts from `sendDlr`, bind and unbind.
   - The retry recursion in `carry` depends on `LinkLife.awaitsNextLink()`, `pending.settle` ordering, and window release in `finally`.
   - Whether a request may be resent (goal 2) is decided here, and it hinges on the `retryOnNextLink` flag. A wrong edit silently duplicates billed traffic.

3. **Expected hard, found easy**
   - The codec: `defs/types.ts` wire types, `PduFramer`, and `parseTlvs`/`writeTlvs` with the typed `Tlvs`.
   - GSM 03.38 escaping, `encodingByDataCoding`, receipt text parsing (`dlr.ts`), `sms-id.ts` normalisation, `ReconnectLoop` backoff, and `udh.ts` IE walking.
   - Each is self-contained, total, and commented at the exact surprising line.

4. **Prose debt**
   - **Needed**:
     - The README "Shutdown" and "Sends and the link" sections, to confirm the drain semantics I was reverse-engineering. They cost a scroll through a 773-line README.
     - The charter's decision index. The titles hinted at intent ("One owner decides whether a link can carry a request, and a bind is what makes it one"), but I was forbidden from `decisions.md`, so several stayed claims I could only check against code. The one above contradicts LinkLife starting `up`.
     - The GSM-unpacked section in the charter, to trust `segmentUnits` (`message.ts:343`).
   - **Defaults live in five places**: `client.ts:45`, `server.ts:403`, `session-options.ts:74`, `reconnect-loop.ts:5` (`backoffDefaults`) and `reassembly.ts:45` (`defaultMaxOctets`, duplicated by `maxHeldOctets`). "Where is the default of X" is a grep.
   - **Told me nothing new**:
     - The charter's architecture table mostly restates file names.
     - Its long paragraph on test conventions is irrelevant to `src/`.
     - `session.ts:201` ("Sends a request and resolves with the peer's response") restates the code.
     - `reconnect-loop.ts:47` ("Read through a method: stop() can land while an attempt is awaiting") hides its real reason: it defeats TS narrowing.
     - `client.ts:101` and `reconnect-loop.ts:84` and `:140` re-implement `errorFrom` inline.

5. **Scores**

   The problem's intrinsic difficulty is high: an interop-heavy protocol, reconnect, and correct-accounting shutdown. It gets no bonus here.

   - **Navigation: 7.** Against "Predictable": file names and the charter's table put a symptom in the right file first try. What keeps it from 8 is that defaults and the shutdown rules are spread across five files each.
   - **Locality: 5.** Against "Honest middle": LinkLife's phase and generation are read from Session, OutgoingRequests, IncomingRequests and HeldMessages. Understanding shutdown or a held message means holding 4–5 files and a synchronous-ordering invariant.
   - **Shape: 6.** Between 5 and 7: most names tell the truth. The named lies are the `up` phase on an unbound socket, `'ASCII'` for GSM 03.38, "bound" meaning two things, `DlrMerger.close` meaning "tombstone", and three near-synonym request methods. Session's constructor fans out to nine collaborators.
   - **Self-sufficiency: 7.** Against "Predictable": the one-line why-comments at the surprising lines resolved nearly every question. I needed the README only for the drain semantics, and the decision titles were claims I could not verify inside the code.
   - **Overall: 6.** Capped by locality at 5 + 1. The hard parts are marked but not localized: they are the problem's own difficulty, spread across collaborators that share link state.

SCORES nav=7 loc=5 shape=6 self=7 overall=6

## Draft B, architect seat

**Comprehension panel: Architect, inherited. @larvit/smpp, draft-b, whole project**

Process note: I read `AGENTS.md` in the same call as `README.md` during step 1, so the map below was not formed from the README and file tree alone. I opened no test file.

## 1. Map from the README and the file tree (verbatim)

Top-level areas I believe exist:
1. **Public surface**: `index.ts`.
2. **Endpoints**: `client.ts` (connect, bind, reconnect-from-start) and `server.ts` (listener, auth, bind answering).
3. **Session core**: `session.ts`, `session-options.ts`, `bind-direction.ts`.
4. **Link lifecycle**: `link-life`, `link-timers`, `reconnect-loop`, `pdu-transport`, `drain` (shutdown?).
5. **Outbound requests**: `outgoing-requests`, `pending-requests`, `send-window`, `send-sms`, `unanswered-error`.
6. **Inbound messages**: `incoming-requests`, `sms.ts` (the handle), `held-messages`, `reassembly`, `concat`, `udh`, `message-body`.
7. **Receipts**: `dlr`, `dlr-merger`, `sms-id`.
8. **Codec**: `pdu`, `pdu-framer`, `pdu-refusal`, `retained-pdu`, and `defs/*` as pure spec tables.
9. **Text**: `message.ts` (encode, split, `smppTime`) and `defs/encodings`.
10. **Plumbing**: `result`, `log`, `error-from`, `uuid`, `expiring-groups`.

Names that do not give their purpose:
- `drain.ts`
- `retained-pdu.ts`
- `expiring-groups.ts`
- `error-from.ts`
- `link-life` vs `link-timers`
- `outgoing-requests` vs `pending-requests` vs `send-window`: three names for "requests we sent"
- `held-messages` vs `reassembly`: both "held" inbound state

Expected from the README but not there: the goal-9 store interface. The README says it has not shipped, so that costs nothing. `interop-tests/` and `benchmarks/` sit outside `src`/`test`.

## 2. Where the map was wrong, and what each correction cost

| Correction | Cost |
| --- | --- |
| `defs/` is not just tables. `defs/types.ts` (684 lines) and `defs/tlvs.ts` are half the wire codec: read, write and size for every field, plus the TLV stream. `pdu.ts` is only the envelope and the body rules. | Moderate. "Where is a field written" lands in `defs`, not `pdu`. |
| `drain.ts` also holds `IdleWaiters`, which `SendWindow` and `HeldMessages` import. The send window depends on the shutdown module. | Low, but it breaks the "which way do imports point" picture. |
| `held-messages` is not a reassembly buffer. It is the inbound messages the *application* has not answered yet. | Moderate: a name-level misread. |
| `link-life` is liveness plus a queue: the phase state machine, and where a request waits for the next link. | Low. |
| Bind handling is not in the session. `server.ts` does it through the `onRequest` hook (`handleRequest`), and `client.ts` has its own `bind()`. | Moderate: two homes for one protocol step. |
| `udh.ts` reads UDHs. Writing one is hand-rolled in `message.ts:114` (`0x05,0x00,0x03,…`), and the outbound reference counter `ConcatReference` sits in `udh.ts`. | Low. |
| `decodeSegments` lives in `reassembly.ts` but is used by `sms.ts`. | Low. |
| `session.ts` is thinner than I expected (424 lines): a coordinator, not a god class. | Pleasant surprise. |

## 3. Fan-out, level by level

- **L0, the README:** about 10 areas. Fine.
- **L1, `src/`:** 37 flat files plus `defs/` (7). **This is the worst level.** Nothing in the layout groups the 10 areas, so only filenames and the `AGENTS.md` list stand in for directories.
- **L2, `session.ts`:** 10 collaborators (DlrMerger, HeldMessages, IncomingRequests, LinkLife, LinkTimers, OutgoingRequests, PduTransport, ReconnectLoop, ConcatReference, drain), plus 6 LinkEffects and 5 LinkEvents. At the edge but legible.
- **L3:**
  - `IncomingRequests`: 8 (Reassembler, DlrMerger, HeldMessages, Session, bind-direction, dlr, concat, sms-id).
  - `OutgoingRequests`: 4.
  - `HeldMessages`: 5.
  - `server.ts`: about 6.
  - `client.ts`: about 8 local functions and a second `ReconnectLoop`.
- **`defs/`:** 7. Fine.

## 4. Names

**One name over two concepts:**
- **"unanswered"** means inbound messages the application has not answered (`drain.ts:52` `messagesUnanswered`, README "Unanswered messages"). It also means our requests the peer did not answer (`UnansweredError`, `SendSmsResult.unanswered`, `SendDlrResult.unanswered`). The drain waits on both kinds in one function.
- **"held"** means `HeldMessages` (inbound, unanswered by the app). It also means a request waiting for a link: `link-life.ts:191` "holding a request until a link is back", and `outgoing-requests.ts:119` `const held = await waitForLink()`.
- **`answered`** in `createSms` (`sms.ts:81`) is a mutable `{ smsId }` box, while `handlers.answered` is the release callback. They are two things on adjacent lines.

**Names that mislead:**
- `EncodingName 'ASCII'` is GSM 03.38.
- `drain.ts` houses the general `IdleWaiters`.
- `defs/` houses the codec.
- `ExpiringGroups` expires nothing itself. Its own doc at `expiring-groups.ts:19` says owners sweep and only `weigh()` evicts.
- `session-options.ts:63` documents `shutdownTimeout` as "how long a drain waits for the requests already on the wire". It also bounds the messages half. That comment is false on exactly the 3am path.

**One concept, many homes:**
- **Defaults live in five places:** `client.ts:45`, `server.ts:403` (idleTimeout 40 000 here vs 2 × enquireLink in the client), `session-options.ts:74`, `reconnect-loop.ts:5` `backoffDefaults`, and `reassembly.ts` `defaultMaxOctets`. The last duplicates `defaults.maxHeldOctets` (same 64 MiB).
- **Two near-identical collectors:** `send-sms.ts:274` `collectSent` and `sms.ts:188` `collectReceipt`.
- **Five concat names:** `Concat`, `ConcatInfo`, `concatOf`, `concatInfo`, `ConcatReference`, spread over `concat.ts` and `udh.ts`.

## 5. What I would restructure, ranked

1. **Group `src/` into about five directories:** `link/`, `outbound/`, `inbound/`, `codec/`, `receipts/`. The seams already exist in the imports; only the layout hides them.
2. **Give defaults one home:** a single `defaults` module, with the client/server differences expressed as named overrides.
3. **Split "unanswered" into two words**, for example "unreleased" for app-side messages and "unanswered" for peer-side requests. Move `IdleWaiters` out of `drain.ts`.
4. **Put UDH read and write in one file,** together with `ConcatReference`, and move `decodeSegments` next to `messageOctets`.
5. **Rename `defs/types.ts`** to what it is, the wire field codec, or move it beside `pdu.ts`.

**What the structure gets right:**
- `LinkLife.transition()` is one explicit table returning effects, and `Session.run` (`session.ts:269`) is the only interpreter of them.
- Collaborators take narrow option objects.
- The result-everywhere rule is applied uniformly.
- `drain()` names its two halves, and `report()` logs which half was left over.
- Comments cite the SMPP section or the operator that forced each odd rule.

## 6. The 3am question

A graceful shutdown hangs until `shutdownTimeout` although `sendResp()` was called on everything.

**Route, cold:** `Session.close` (`session.ts:254`) → `Session.drain` (`session.ts:300`) → `drain()` (`drain.ts:96`). That took about 3 minutes, because the filename and the function name agree. Deciding which half took about 10 more minutes:
- With every `sendResp` done, `HeldMessages.idle` should settle. Release happens at `held-messages.ts:170` via `sms.ts:159`.
- So the right unit is the second half: `OutgoingRequests.idle` (`outgoing-requests.ts:109`) → `SendWindow.idle`/`unfinished` (`send-window.ts:65`).
- That means a request of ours is still in flight. Typically it is the `sendDlr()` receipts that `requestPastDrain` let through, or a heartbeat `enquire_link` the peer is not answering.
- Each such request is bounded by `responseTimeout` (30 s), which is longer than `shutdownTimeout` (5 s).

**Second suspect:** `sendResp` returned `err` because the write failed, and the application ignored it. The message is then never released (`sms.ts:159` releases only on success).

The log lines `drain - shutting down with requests unfinished` and `drain - shutting down with messages unanswered` separate the two. The false comment at `session-options.ts:63` costs a detour.

**Where it rots first:**
- **`HeldMessages`:** six numbered exits. A listener count taken via `listenerCount('sms')` at `keep()` (`held-messages.ts:154`) and decremented through `captureRejections` routed from `session.ts:97`. A `WeakMap` keyed on the handle's identity, and a back-reference to the half-constructed `Session` (`session.ts:137`).
- **The link-generation checks:** repeated in `sms.ts` (`lostLink`), `incoming-requests.ts:90/97` and `held-messages.ts:95`. Each is a local copy of one invariant.

**Where the next two features land:**
- **Goal-9 store:** behind `ExpiringGroups`, whose three owners (`DlrMerger`, `Reassembler`, `HeldMessages`) each use a different subset of its semantics: sweep callbacks, `weigh()` eviction, `full`. A store has to replicate all three contracts.
- **Per-PDU rate-limit hook (goal 7):** `OutgoingRequests.carry` (`outgoing-requests.ts:114`), between `window.acquire` and `attempt`. That place is clean and local.
- A custom alphabet would instead ripple through the closed `EncodingName` union: `message.ts:14` `segmentUnits`, `dataCodingByEncoding`, and the `send-sms` checks.

## 7. Hardest places, ranked

1. **`src/held-messages.ts:40`, `HeldMessages`:** `offer` :94, `listenerRejected` :117, `keep` :154, `release` :170. It has six exits, identity-keyed release, a listener-count countdown, and is coupled to the `Session` emitter.
2. **`src/outgoing-requests.ts:70/85/101`, `request` / `requestPastDrain` / `requestOnCurrentLink`:** three entry points that differ in which gates they skip (drain refusal, link wait, window). The bind bypass is buried inside `requestPastDrain`, and the `isStopping() && canCarry()` gate needs a second read.
3. **`src/link-life.ts:74`, `LinkLife.transition`,** with `lose` :148 and `end` :159. A `stopping` flag orthogonal to the phase, `'bound'` while stopping turning into a loss, and effect order that matters in `Session.run` (`session.ts:269`, where `dropLink` clears four stores).
4. **`src/drain.ts:70/96`, `answeringBudget` and `drain`:** `0` means forever except for the messages half, plus a `setImmediate` turn whose job is to catch a receipt issued right after the last answer.
5. **`src/reassembly.ts:188`, `Reassembler.trim`,** with `collect` :111. The eviction arithmetic (`parts.size - 1` when the current group is itself evicted) is correct but has to be derived.
6. **`src/expiring-groups.ts:19/70`, `ExpiringGroups.weigh`:** it evicts, `set` does not, and owners must sweep. Its callers' correctness depends on remembering which.
7. **`src/pdu.ts:84/113`, `resolveShortMessage` / `resolveBody`:** which field the `data_coding` describes, and when detection may overwrite it.
8. **`src/client.ts:263/286`, `initialAttempts` / `keepTrying`:** a second `ReconnectLoop`, with a fresh `Session` per attempt, for `fromStart`.

**Single unit I would least want to modify:** `HeldMessages` (`src/held-messages.ts`).

## 8. Intrinsic difficulty

This is an SMPP session layer with reconnect, graceful drain, bounded reassembly, receipt merging and a hand-rolled wire codec. The problem itself is moderately high in difficulty, and gets no bonus in the scores.

## 9. Scores

- **Navigation 7:** matches the "predictable" anchor. Descriptive filenames and function names took me from the symptom to `drain()` in minutes, and `report()` logs which half stalled. The flat 37-file `src/` and the false `shutdownTimeout` comment keep it from 8.
- **Locality 6:** between "honest middle" and "predictable". `HeldMessages` and `IncomingRequests` call back into `Session` (emit, `sendReturn`, `close`), the link-generation invariant is copied into three places, `Session.run` effect order is load-bearing, and defaults live in five files.
- **Shape 6:** between the anchors. L2 and L3 fan-out is bounded and most names tell the truth. `src/` fans out to 37 files, and "unanswered", "held", `'ASCII'`, `drain.ts` and `defs/` each name something other than what they hold.
- **Self-sufficiency 7:** the "predictable" anchor. Invariants are stated at the code (ExpiringGroups' contract, the six exits, SMPP section citations), and I did not need a second document open. It misses 8 on one false option comment and a few budget rules (`answeringBudget`) that need rereading.
- **Overall 6:** capped at the lowest dimension plus one (7). It sits at 6 because the hardest code (the held-message flow and outbound gating) is exactly where locality is weakest.

SCORES nav=7 loc=6 shape=6 self=7 overall=6
