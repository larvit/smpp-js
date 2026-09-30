# Lessons from three redesign rounds

A four-seat comprehension panel reads the whole project: a junior, a mid, a maintainability senior and an inherited-system architect. It scores on an absolute 1–10 scale, where 7 = "Predictable: the layout answers where things live; the hard parts are hard because the problem is hard, few, localized and marked". There are four dimensions: Navigation, Locality, Shape and Self-sufficiency. The overall may not exceed the lowest dimension plus one. The target is a mean overall at least one full point above main.

| | Overall per seat | Mean | Locality |
| --- | --- | --- | --- |
| Main today | 6, 6, 7, 6 | 6.25 | 5, 5, 6, 6 |
| A: internals only; a `Link` object per socket | 6, 6, 6, 6 | 6.0 | 5, 5, 6, 6 |
| B: internals only; the lifecycle as one state machine (reducer returns effects, `Session` runs them) | 6, 6, 6, 6 | 6.0 | 6, 6, 5, 6 |
| C: contract change; `onSms` handler option, every message answered `ESME_ROK` on arrival, `sendResp()` removed, `src/` grouped into session/, messages/, wire/, defs/ | 6, 6, 6, 6 | 6.0 | 6, 6, 6, 6 |
| D: contract change; `onSms` handler, message held while its promise runs, `sendResp()` kept, no handler means refuse with the retry status | 5, 6, 7, 6 | 6.0 | 5, 6, 6, 6 |

Their full diffs are `drafts/draft-a.patch` to `drafts/draft-d.patch`; each carries the draft's own DESIGN.md.

What the panels taught:
1. **Restructuring internals under the old contract does not move the scores (A, B).** The held-message timing contract capped every seat: six exits, a `setImmediate` turn, listener counts, `captureRejections` routed through a `WeakMap`.
2. **Changing the receiving contract to an `onSms` handler removed that cap (C, D).** In C no reader named the held-message flow; D's junior still did, because "answered" lived in three places (a closure flag, a store field, and `answeredOnArrival`).
3. **The new ceiling is the session lifecycle.** Seven of eight round-two seats named the same unit they would least want to modify:
   - `LinkLife`: a 4-value phase plus a separate `stopped` flag, whose initial `'up'` is an exception to its own rule.
   - Seven predicates over it (`isUp`, `isAttached`, `isOver`, `isStopped`, `retrying`, `awaitsNextLink`, `refusal`), read by `Session`, `OutgoingRequests` and `IncomingRequests`.
   - `Session.linkLost`/`end`/`dropSocket`/`comeBackUp`, whose correctness hangs on call order.
   - Listeners of `disconnected`/`close` re-entering `close()` synchronously.
   - `ReconnectLoop`'s own stopped flag duplicating `LinkLife`'s.
   - client.ts's `bindOn` relying on `close()` reaching `stop()` before its first await, stated in another file.

   B tried a single state machine, but under the old contract, where the held-message cap hid any gain.
4. **Also still cited:**
   - `IncomingRequests`/`HeldMessages` call back into `Session` (`emit`, `sendReturn`, `close`, `listenerCount`).
   - `OutgoingRequests`' several entry points, or lanes, and its retry loop, which depends on link state at each await.
   - `ExpiringGroups` leaves enforcement to its three owners.
   - The GSM 03.38 codec is still named `ascii` somewhere.
   - `DlrMerger.close` really means "spend".
   - There is no glossary for the SMPP terms (ESME, SMSC/MC, esm_class, data_coding, UDH, sar_*, TLV).
   - SMPP section citations with no summary.
   - Defaults are spread over several files.
5. **Goal checks the drafts raised:**
   - C answers `ESME_ROK` before the application has taken the message, so a crash loses it. That is a goal 2 risk: "work the peer has no reason to send again is not dropped".
   - D's "no handler, so refuse every inbound message with the retry status" is a judgement call. If you keep something like it, record it in docs/decisions.md with the goal it rests on.

## Round three

| | Overall per seat | Mean | Locality |
| --- | --- | --- | --- |
| E: an `onSms` handler whose message is answered when the handler returns, plus the lifecycle as one state machine (`connected, bound, closing, down, ended`) | 5, 7, 6, 6 | 6.0 | 5, 6, 6, 6 |
| F: a Session is one socket's life, bound once and ended once; reconnect is an `SmppClient` composed above it; `onSms` answered on return | 6, 6, 7, 6 | 6.25 | 5, 5, 6, 6 |

Diffs: `drafts/draft-e.patch` and `drafts/draft-f.patch`.

What round three taught:
- **The hardest unit moves every round.**
  - Round 1: the held-message flow.
  - Round 2: the handler contract removed it, and the lifecycle took its place.
  - Round 3: F's one-socket session removed the lifecycle, and readers now name other units:
    - `ExpiringGroups` with `Reassembler.trim`, named by 4 of 8 seats: `set()` or `weigh()` may evict the caller's own entry, reads mutate and fire callbacks, and three owners depend on drop order;
    - the invariant "every inbound PDU gets exactly one answer", enforced jointly by `IncomingRequests` and `sms.ts`.
  - E's state machine was still hard, because each transition's meaning is split across five callbacks in another file.
- **Juniors score Self-sufficiency 5** even with a README glossary. The cost is SMPP knowledge: spec section numbers with no summary, and the `data_coding` bit masks. That caps a junior's overall at 6.
- **A fix sometimes adds a smaller hard spot of its own**, as D's "answered" in three places and E's callbacks show.
- **The scale is coarse**: four integer seats, so one seat moving one point shifts the mean by 0.25.
