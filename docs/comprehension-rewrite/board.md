# Board on the three rewrite plans

## Junior seat

**Junior seat** (about 2 years of TypeScript, no SMPP)

My read of main: `link-life.ts` has 7 predicates over a phase plus a separate `stopped` flag, and the initial `'up'` breaks its own rule. `expiring-groups.ts` has a header that says what it does *not* enforce. `session.ts` routes `captureRejections` for `sms` into `incoming.listenerRejected`. The README's "Receive SMS" section tells me to call `sendResp()` on a multipart message that "puts nothing on the wire". I agree with 6 overall and Locality 5.

## Plan 1: folders follow the README
1. **Would it help? Marginal, close to yes.** Folders named after the README sections are the first layout I could find things in without asking. The problem is answering: I can answer with `sendResp()`, by returning, or by throwing, and `answeredOnArrival` is still there. That is D's "answered in three places" again, only now behind `OwedAnswer`.
2. **Predicted scores**
   - Nav 7: README section maps to folder.
   - Loc 6: the answer path spans `receive-message.ts`, `running-handlers.ts`, `owed-answer.ts` and `sms.ts`.
   - Shape 6: the `AnswerPort`/`SendPort` ports are indirection I have to learn.
   - Self 6: citations get summaries, but the glossary sits in the README, and lessons.md says that did not lift juniors.
   - Overall 6.
3. **Where I would still get stuck:** `receiving/running-handlers.ts` together with `session/owed-answer.ts`. What happens when `sendResp()` is called and the handler then throws?
4. **Wrong or vague**
   - The "two SmsSenders" question is left open until chunk 6.
   - `client()` returns a `ClientSession` but still calls it `session`, and `sock`/`sendReturn` move to `session.link`. I would not know which object to listen on.
   - Keeping `sendResp()` next to "return answers" gives two ways to answer.
   - The no-handler refusal turns a transceiver that never wanted inbound messages into an endless SMSC retry loop.

## Plan 2: state ownership first
1. **Would it help? Marginal.** It keeps one public `Session` over many internal `Link`s, which brings back the thing F removed: the lifecycle is still split over two fields. It adds `LinkOwner`, five callbacks implemented in another file, which is E's lesson again. `session.ts` stays the hub for handover, link-wait, reconnect and the merger.
2. **Predicted scores**
   - Nav 6: the Session versus Link vocabulary. `sms.ts` sits in `session/` while `handlers.ts` sits in `link/`.
   - Loc 6: there is one answer ledger, but handover is split across `adopt`/`onGone` and the callbacks.
   - Shape 6: four request lanes are still four rules.
   - Self 6: `wire/fields.ts` helps, but the glossary sits away from the code in `docs/`.
   - Overall 6.
3. **Where I would still get stuck:** `session/session.ts` handover together with `link/link.ts`'s `LinkOwner`.
4. **Wrong or vague**
   - This plan has the smallest API break of the three, and that is the best part for an application developer.
   - The `sendDlr`-before-answer error will surprise anyone writing a test SMSC.
   - The reassembly store refusing its own entry is a behaviour change with no decision written yet.

## Plan 3: the newcomer's lens
1. **Would it help? Yes.** `protocol/vocabulary.ts` puts TSDoc on hover, and all bit masks stay inside `protocol/`. `data-coding.ts` becomes a table with a "why" column, and a test fails on any bare citation. That attacks the Self-sufficiency 5 that capped juniors. `Reply` as a return value makes "one answer" a type.
2. **Predicted scores**
   - Nav 7: protocol, codec, messages, session is a reading order.
   - Loc 6: `client/client.ts` gathers the current session, the merge, the reference counter, the retry loop, re-emitting, `fromStart` and abort.
   - Shape 7: forward-only session, a store that refuses, `Reply` as the one path.
   - Self 7: definitions at the point of use.
   - Overall 6, one refactor short of 7.
3. **Where I would still get stuck:** the request loop and event re-emitting in `client/client.ts`. The plan itself predicts this.
4. **Wrong or vague**
   - It has six breaks. A1 renames `{ session }` to `{ client }`, which breaks every README example for no comprehension gain beyond F, which scored the same as main.
   - A3's `Reply.dlr` is a second way to send a receipt next to `sendDlr()`.
   - A4 removes `sendReturn()`, the escape hatch for hand-wired users.
   - `handlerTimeout` appears in `handlers.ts` but is missing from the API table.
   - Refuse-not-evict can block multipart traffic for `reassemblyTimeout`, which regresses goal 4.
   - `waiting.ts` extracts the abort dance, contradicting a recorded decision without saying so.
   - A6 (`'ASCII'` to `'GSM7'`) is justified for me as a reader, but it is optional.

## Verdict
- **Ranking:** Plan 3, Plan 1, Plan 2.
- **Can the best reach 7?** Plausibly, about a coin flip. The single change that most raises its odds: move the retry loop and the link-wait out of `client/client.ts` into their own file, `client/next-link.ts` as in Plan 1, so `SmppClient` only holds and forwards. Dropping A1 and A3 would also stop the application-developer complaints from costing Shape.
- **Structure or intrinsic difficulty?** Mostly structure. Each round moved the hardness around while the SMPP-to-plain-types translation was never in one place. The truly intrinsic parts are small and can be localized: per-segment answers on arrival, the drain's two budgets, and retrying only what was never written. For a junior, the rest of the ceiling was missing domain vocabulary. That is a structural choice about where meaning lives, not a property of the problem.

PLAN1 helps=marginal nav=7 loc=6 shape=6 self=6 overall=6
PLAN2 helps=marginal nav=6 loc=6 shape=6 self=6 overall=6
PLAN3 helps=yes nav=7 loc=6 shape=7 self=7 overall=6

## Mid seat

**Mid seat (5 years TypeScript, never read the SMPP spec)**

My view of main today: 6. I can find my way around the flat `src/`, and `session.ts` is readable at the top. `LinkLife` is where I stall. It has a phase, a `stopped` flag, seven predicates and an initial `'up'` that breaks its own rule. `ExpiringGroups` is the other place: its doc comment says it enforces neither of its own bounds, yet `weigh()` can evict the key the caller is writing. The `captureRejections` routing to `incoming.listenerRejected` also takes me three files to follow.

## Plan 1: README verbs as folders, a one-socket Session, and ClientSession

1. **Helps? Marginal, leaning yes.** Folders that mirror the README's table of contents are what I would guess first. `owed-answer.ts` gives "one answer per request" a single writer, and `BoundedStore` stops evicting the caller's own entry. But the one-socket split is F's, which already scored 6.25, and the plan leaves its sharpest follow-up open: which object owns `SmsSender`, to be settled "at chunk 6".
2. **Predicted scores:**
   - Navigation 7: the folder names are the README sections.
   - Locality 6: an inbound message still crosses `dispatch.ts`, `receive-message.ts`, `running-handlers.ts`, `owed-answer.ts` and `sms.ts`.
   - Shape 6: `ClientSession` forwards events, and there are two `SmsSender`s and two ports.
   - Self-sufficiency 7: the README glossary, citations with their summaries, and `Invariant:` paragraphs.
   - Overall 6.
3. **What would still defeat me:** `client/client.ts`. A `ClientSession` that re-emits the current `Session`'s events, answers `boundAs` through the reconnect gap, and holds a merger fed from the link's `dlr`. It is the "which object do I listen on" problem moved up one layer.
4. **Wrong or vague:**
   - `client()` still resolves `{ session }`, but the value is a `ClientSession` and `session.link` is the real `Session`. That name misleads an application developer.
   - `sendResp()` is kept, and returning from the handler also answers. That is two ways to answer the same message, and `answeredOnArrival` stays as a third concept.
   - `limits/` is an abstraction name I would not look in for the send window.
   - The dual `SmsSender` is undecided.

## Plan 2: state ownership, with a Link inside the public Session

1. **Helps? Marginal.** The ownership rules are right: one writer, a lifetime `AbortController`, and "emit last". `wire/fields.ts` naming the bit masks helps me more than any glossary. But `Session` still spans many links, which is the unit that capped round two, now split across `session.ts` and `link.ts`. They are joined by `LinkOwner`, a five-callback interface, which is exactly what defeated E.
2. **Predicted scores:**
   - Navigation 6: `link/` against `session/` is a distinction I must learn before I can place `handlers.ts`, `sms.ts` or `send-sms.ts`.
   - Locality 6: the answering path is in two adjacent files, which is good, but a link going down spans `Link`, `LinkOwner`, `adopt`/`onGone`, `link-wait.ts` and `outbound.ts`.
   - Shape 6: four lanes in one table are still four rules. `sock` means "the current or last Link's", and `boundAs` is read "from the last bound Link".
   - Self-sufficiency 6: the glossary lives in `docs/glossary.md`, away from the code, and the lessons say an off-code glossary did not lift juniors.
   - Overall 6.
3. **What would still defeat me:** `session/session.ts` `adopt`/`onGone`, with `session/outbound.ts`'s retry loop that goes back to `boundLink()`. That is the reconnect lifecycle again, under new names.
4. **Wrong or vague:**
   - It keeps the reconnecting `Session` to avoid F's rename. That preserves the exact structure every round-two seat named.
   - Changing `sendReturn()` to return `err` in two new cases is a silent behaviour change on an existing call.
   - The rule "a `sendDlr()` before the answer returns `err`" breaks test-double servers that report immediately, and the plan admits it.
   - The five callbacks and the lane table are not specified.

## Plan 3: a `protocol/` translation layer, `Reply` return values, and SmppClient

1. **Helps? Yes.** This is the only plan aimed at my actual cost: the bit masks and SMPP terms, translated once in `protocol/` into typed plain values, with definitions I see on hover in the editor. A citation test enforces that every spec reference carries its sentence. `requests-in.ts replyFor()` is a pure function returning a `Reply`, which makes "one answer per request" a type instead of an agreement between files. Its `Session` is one socket with one forward-only state field.
2. **Predicted scores:**
   - Navigation 7: `codec`, `protocol`, `messages`, `session`, `client`, `server` read in order. The weak spots are `retained.ts` and `bounded-store.ts` under `messages/`.
   - Locality 7: a reply is decided in one function and written in one place, and data_coding is one table.
   - Shape 6: two `sendSms` surfaces, `Reply.dlr` beside `sendDlr()`, and a `SmppClient` hub.
   - Self-sufficiency 7: definitions next to their use, and every citation says what it cites.
   - Overall 7.
3. **What would still defeat me:** `client/client.ts`. It holds the current session, the receipt merge, the concatenation reference counter, the retry-if-unwritten request loop, event re-emission, `close`/`unbind`, and `fromStart` plus abort. That is seven responsibilities in one file, and the plan itself predicts it becomes the next hardest unit.
4. **Wrong or vague:**
   - Six breaking changes is more than "a minimum". A6 (`'ASCII'` renamed to `'GSM7'`) breaks every caller that set an encoding. It is justified by one-spelling-per-goal but not required for comprehension, since the internal rename already gets that gain.
   - A3's `Reply.dlr` is a second way to send a receipt.
   - Refusing new segments when the reassembly store is full, instead of evicting the oldest group, lets abandoned groups block all multipart traffic until `reassemblyTimeout`. That hurts an operator (goal 4), and the plan does not weigh it against the goal 2 gain.
   - Removing `sendReturn()` takes away an escape hatch for low-level users without saying what replaces it beyond "return a `Reply`".
   - `retained.ts` sits in `messages/` only because the stores use it. That is proximity, not a real seam.

## Verdict

**Ranking:** Plan 3, then Plan 1, then Plan 2.

**Can the best reach 7 overall?** Plausibly on my seat. A panel mean of 7 is less likely, because the architect seat will cite the `SmppClient` hub and the number of API breaks. The single change that would most raise its odds is to split `SmppClient`'s request loop into its own file (`client/next-link.ts`, as in Plan 1), owning waiting-for-a-bound-session and retry-only-unwritten with its invariant. `client.ts` then only composes, and the predicted next hardest unit never forms.

**Structure or intrinsic difficulty?** Mostly structure, and specifically the contract that structure was built around. Each round, the named hardest unit was self-inflicted rather than SMPP:
- the held-message timing contract;
- a reconnecting session with duplicated stop flags;
- a store that does not enforce its own bounds;
- answering enforced jointly by two files.

When the contract changed, the unit moved, and none of the ones named since are protocol facts. The intrinsic part — multipart answered on arrival, the drain's two budgets, retrying only what never reached the socket, and data_coding groups — is real. But it is a handful of localized items, which puts the ceiling near 7–8, not 6. The earlier redesigns stalled because each one left a different piece of shared, unowned state behind.

PLAN1 helps=marginal nav=7 loc=6 shape=6 self=7 overall=6
PLAN2 helps=marginal nav=6 loc=6 shape=6 self=6 overall=6
PLAN3 helps=yes nav=7 loc=7 shape=6 self=7 overall=7

## Senior seat

Plan 3 is the only one I expect to reach 7. Plan 1 is a marginal gain and plan 2 is roughly main plus renames. My seat most likely already gave main its 7, so a rewrite has to beat 7 on this seat to count as help here.

**How hard main is today, from my seat.** `link-life.ts` shows lesson 3 exactly. It has a 4-value phase starting at `'up'`, a separate `stopped`, and seven predicates. Its `generation()` counter exists only so a reader can tell a link has gone. `session.ts` (453 lines) wires ten collaborators. Its `captureRejectionSymbol` override reaches into `incoming.listenerRejected`. The layout is flat and named well, so Navigation is fine. The cost is in Locality: to know whether a send is safe you need `LinkLife`, `OutgoingRequests` and `Session` open together.

---

## Plan 1: verb folders, one-socket `Session`, `ClientSession` above it, `onSms` plus `sendResp` kept

**1. Would it help? Marginal.**
- The one-way `Session`, the reconnect union state, `BoundedStore` enforcing its own bounds and one defaults file all remove units the panels named.
- It adds new sources of confusion in their place:
  - `client()` still returns a field called `session` that is a `ClientSession`, and `session.link` is a `Session`. Two names now lie.
  - Answering has two spellings. The handler can call `sendResp()` or just return, and the return path does "answer `ESME_ROK` if not answered". That is D's "answered in several places" again, now as a getter over OwedAnswers.
  - The answer path spans five files in two folders: `dispatch.ts`, `owed-answer.ts`, `receive-message.ts`, `running-handlers.ts` and `sms.ts`.

**2. Predicted scores**
- **Navigation 7.** The README table of contents mirrors the folder listing, which makes the layout easy to find your way around. `limits/` is the one abstract name.
- **Locality 6.** The one-answer invariant has one writer, but you cannot understand it without the other four files. `AnswerPort` and `SendPort` add a hop.
- **Shape 6.** `ClientSession` forwards a long event list. Whether there is one `SmsSender` or two is left open.
- **Self-sufficiency 7.** Every citation gets a summary, the README gets a glossary, and there is a data-coding table.
- **Overall 7**, one point above the lowest dimension (Locality 6), which is the most the rule allows. It is no better than main on this seat.

**3. Where I would still get stuck.** `client/client.ts` together with `client/next-link.ts`: `ClientSession` forwarding events from whichever `Session` is current, plus answering `boundAs` through the reconnect gap. Second place: `session/owed-answer.ts` together with `receiving/running-handlers.ts`.

**4. Wrong or vague**
- `SmsSender` is left as "pick one at chunk 6". That is an ownership question, and the plan's own principle says ownership comes first.
- Returning `ClientSession` under the name `session` is a public API that misleads the developer about what they hold. Either rename it honestly, as plan 3 does, or keep a single `Session`.
- Keeping `sendResp()` alongside the implicit return answer gives two ways to answer, against the one-spelling rule.
- `linkEnd` becoming readonly is justified.

---

## Plan 2: state ownership, a `Link` per socket behind the unchanged public `Session`

**1. Would it help? Marginal.**
- The strongest ownership rules of the three: one `AbortController` as the single writer of stoppedness, and "a transition finishes before anyone hears about it".
- The smallest API break, with a single answering spelling (`onSms` returning `{smsId}`/`{status}`) and a ledger that refuses a second answer.
- But its structure is draft A (a `Link` object per socket) plus E's weakness (`LinkOwner`, five callbacks implemented in another file). Lesson 3 of the round-three notes already says E's state machine stayed hard because meaning was split across callbacks.
- `session.ts` stays the hub: life, current link, handover, link-wait, window, reconnect, merger.
- `outbound.ts` keeps four "lanes", which were already cited in round 2.

**2. Predicted scores**
- **Navigation 6.** Readers must learn the Session/Link split. `link/` holds handlers and reassembly, which a reader would not look for there.
- **Locality 6.** A handover is `adopt`/`onGone` in `session.ts` plus the `LinkOwner` callbacks in `link.ts`. Each transition's meaning is split across two files.
- **Shape 6.** Four lanes, a hub `Session`, and a new "refuse own entry" eviction policy.
- **Self-sufficiency 7.** `wire/fields.ts` names the bit masks, and every citation gets its sentence.
- **Overall 6.**

**3. Where I would still get stuck.** `session/session.ts` (`adopt`/`onGone` and the link handover) read against `link/link.ts`'s `LinkOwner`. Second place: the lane table in `session/outbound.ts`.

**4. Wrong or vague**
- `sendDlr()` returning `err` before the answer is a trap for test SMSCs that report immediately. The plan admits this and gives only a README pattern as the fix.
- The own-entry refusal changes reassembly behaviour under pressure without a stated goal trade-off.
- It is unclear where `idle-waiters` ends up: the plan says "inlined" in two places.
- It never says whether `generation()`'s replacement ("a message holds its Link") keeps a gone `Link` alive in memory.

---

## Plan 3: a `protocol/` translation layer, answers as `Reply` return values, `SmppClient` above a one-socket `Session`

**1. Would it help? Yes.**
- It is the only plan that makes "one answer per request" a type. `replyFor()` returns a `Reply`, and `Session.write()` is the single writer. `onRequest` also returns a `Reply`, and `sendReturn` is gone.
- Bit masks never leave `protocol/`, and a test fails on any bare `§x.y.z` citation. That targets the junior Self-sufficiency cap directly.
- `BoundedStore` is kept simple.
- It removes the lifecycle cap the same way F did.

**2. Predicted scores**
- **Navigation 7.** The areas read in order: protocol → codec → messages → session → client. The only open question is which `sendSms` to call.
- **Locality 7.** Answering, the lifecycle and the drain each live in one function. The exception is the `client.ts` hub.
- **Shape 7.** State sits in three named files and reconnect lives above the socket. `Reply.dlr` is a wart.
- **Self-sufficiency 7.** The glossary is in code, shown on hover, and citations are enforced by a test. `field-types.ts` stays dense.
- **Overall 7.**

**3. Where I would still get stuck.** `client/client.ts`. It holds the current session, the receipt merge, the segment reference counter, the request loop that retries only unwritten requests, event re-emitting, `close`/`unbind` and `fromStart` plus abort. That is F's `SmppClient` with more loaded onto it, and the lessons predict the hardest unit lands here next.

**4. Wrong or vague**
- **The async path is not described.** `replyFor()` is described as pure, but `onSms` is asynchronous. The plan never names the one function that carries a message from `replyFor` through `handlers.ts` to `session.write`. Without it, "exactly one answer" spreads back over three files.
- **A6 (`'ASCII'` renamed to `'GSM7'`) is unjustified.** It breaks every caller for a name the code can gloss once, and goal 8 favours a stable surface.
- **A3 (`Reply.dlr`) adds a second way to send a receipt** beside `sms.sendDlr()`.
- **Refuse-not-evict for reassembly** lets a peer that abandons segment groups block all multipart traffic for `reassemblyTimeout`. That is an operator-facing regression under goal 4, and "goal 2 served better" does not hold for traffic we refuse and the peer then gives up on.
- **A1 renames `session` to `client`** on `client()`'s result. That is defensible: it is honest where plan 1 is not, but it is a real migration cost.
- It is silent on goal 9 (a store interface). `BoundedStore`'s shape should not make that goal harder later.

---

## Verdict

**Ranking:** plan 3, then plan 1, then plan 2.

**Can the best reach 7 overall?** Plausibly yes, as a mean around 6.75 to 7, if it drops A3 and A6. The single change that would most raise its odds: move the retry-only-unwritten request loop out of `client/client.ts` into its own file, like plan 1's `client/next-link.ts`, with its invariant at the top. The same file or function should also carry the async `onSms` reply path, so that neither `SmppClient` nor the answer path becomes the next hardest unit.

**Structure or intrinsic difficulty?** Mostly structure.
- The hardest unit moved every round: the held-message flow, then the lifecycle, then `ExpiringGroups` and the answer invariant. Intrinsic difficulty does not move when you reorganise, so a cap that moves each time is coming from coupling.
- Every draft so far kept at least one object that held both the socket and what outlives the socket, or both the answer and its trigger. The panel scores that worst unit.
- The intrinsic core does set a floor: answering each segment on arrival, the drain's two budgets, retrying only what was never written, and `data_coding`. That floor is about 7 and is not what capped the drafts at 6.
- The coarse four-seat integer scale explains why every drop in difficulty looked like no movement at all.

PLAN1 helps=marginal nav=7 loc=6 shape=6 self=7 overall=7
PLAN2 helps=marginal nav=6 loc=6 shape=6 self=7 overall=6
PLAN3 helps=yes nav=7 loc=7 shape=7 self=7 overall=7

## Architect seat

**Board seat: inherited architect.** I read `link-life.ts` (a four-value phase plus `stopped`, seven predicates, and an initial `'up'`), `expiring-groups.ts` (which says outright that it "enforces neither max nor timeout itself") and `session.ts`. My view matches the panel: 6 overall, Locality 6. The hard spots are ones the code created, not ones SMPP forces.

## Plan 1: folders named after what the developer does, `ClientSession` above a one-socket `Session`

1. **Would it help?** Marginal. It combines F's one-socket split with D's handler that keeps `sendResp()`, and both scored 6 before. Answering is now spread over four files in two folders: `session/owed-answer.ts`, `receiving/receive-message.ts`, `receiving/running-handlers.ts` and `receiving/sms.ts`. The ports (`AnswerPort`, `SendPort`) add names without removing a step.
2. **Predicted scores:**
   - Nav 6: folders named after what the developer does are good. But `client()` still resolves `{ session }`, and that value is a `ClientSession` whose `.link` is the real `Session`, so the name lies at the first line of every example. `limits/` is a catch-all name.
   - Loc 6: the one-answer rule has one writer, but the path to that writer crosses two folders through ports.
   - Shape 6: `sendResp()` and returning from the handler are two ways to answer. "Two `SmsSender`s in client mode" is left unresolved.
   - Self 6: the glossary goes in the README, which the lessons say did not lift juniors.
   - Overall 6.
3. **Where it still defeats me:** `client/client.ts`. It re-emits the current link's events, answers `boundAs` through the reconnect gap and owns the merger across links, while `client/next-link.ts` retries underneath it. This is F's `SmppClient` again.
4. **Wrong or vague:**
   - Keeping the name `session` for a `ClientSession` is harmful. An app developer calls `session.sock` or `session.sendReturn()` and finds them moved to `session.link`.
   - Which object owns the `SmsSender` is left open "until chunk 6", and that is the part most likely to rot.
   - `sendResp()` plus answer-on-return breaks the one-spelling rule.
   - Making `linkEnd` readonly is fine.

## Plan 2: every piece of state has one owner, a private `Link` per socket behind the public `Session`

1. **Would it help?** Marginal, leaning yes. The ownership discipline is the most honest of the three: a phase that only moves forward, one `AbortController` as the only stop signal, and `link/answers.ts` refusing a second answer. But `Session` stays the hub (current link, link wait, send window, reconnect, merger, handover). `Link` reports to it through a five-callback `LinkOwner`, which is the same shape E's panel called hard. The retry still spans links, in `session/outbound.ts` with four lanes.
2. **Predicted scores:**
   - Nav 6: a `Session` versus `Link` vocabulary gap. Held messages and reassembly under `link/` surprise a reader who thinks of them as message concerns.
   - Loc 6: a transition's meaning is split between `link.ts` and the `LinkOwner` callbacks implemented in `session.ts`.
   - Shape 7: one writer per piece of state, and invariants stated at their owner.
   - Self 6: `wire/fields.ts` names the bit masks, but the glossary sits in `docs/`, away from where the terms are used.
   - Overall 6.
3. **Where it still defeats me:** `session/session.ts`, in `adopt()`/`onGone()` together with `session/outbound.ts`'s loop over `boundLink()`. That is the reconnect lifecycle kept inside the public unit, only renamed.
4. **Wrong or vague:**
   - It keeps reconnect inside `Session`, which the lessons show is where the ceiling sits. The plan says the rename to `SmppClient` "bought nothing a reader scores", but F's gain was exactly the removal of the lifecycle from the list of hardest units.
   - The four lanes stay four rules.
   - Refusing the incoming segment when a store is full is a behaviour change under pressure, and the plan argues it only as a risk.
   - The API changes are the most conservative: `sendResp()` becomes the handler's return value, `sendDlr()` before the answer returns `err`, and a double `sendReturn()` returns `err`. All are justified.

## Plan 3: plain-English protocol types, answers as return values, `SmppClient` above a one-socket `Session`

1. **Would it help?** Yes. It is the only plan that attacks all three standing caps at once:
   - **Lifecycle:** one socket per `Session`, with reconnect in `SmppClient`.
   - **Answering:** an answer is a `Reply` value, `requests-in.ts` is a pure function, and `session.write()` is the single writer. "Exactly one answer" becomes something the type system enforces.
   - **Self-sufficiency:** `protocol/vocabulary.ts` gives definitions on hover, `data-coding.ts` becomes a table checked against today's code on all 256 values, and a test fails on any bare spec citation. Of the three, this is the one that actually changes a junior's Self-sufficiency.
2. **Predicted scores:**
   - Nav 7: the folder order (`protocol` → `codec` → `messages` → `session` → `client`) tells you where a question is answered.
   - Loc 6: `client/client.ts` gathers the current session, state kept across links, the retry loop, event re-emitting, `fromStart` and abort in one file.
   - Shape 7: pure `replyFor()`, a store that refuses rather than evicts and never mutates on read, and a lifecycle that only moves forward.
   - Self 7: vocabulary beside the code, and the citation rule enforced by a test.
   - Overall 7, but only just.
3. **Where it still defeats me:** `client/client.ts` (`SmppClient`). The request loop waits for a bound session across reconnects, retries only what was never written, and re-emits events, all next to the `fromStart` and abort handling. The plan's own risk list predicts this file. `session/handlers.ts` converting a handler's outcome into a `Reply` for a message already answered on arrival comes second.
4. **Wrong or vague:**
   - Six breaking changes where two carry the value.
     - **A3** (`Reply.dlr`) is a second way to send a receipt beside `sendDlr()`. It is unjustified; drop it.
     - **A6** (`'ASCII'` → `'GSM7'`) breaks every caller for a name that can be glossed once inside the library. Drop it.
     - **A1** (`{ client }` in place of `{ session }`) is justified, and it is more honest than plan 1's `session` that is really a client.
   - Refuse-not-evict means a peer that abandons segment groups blocks all new multipart traffic for `reassemblyTimeout`. The goal 4 regression is argued only in one direction.
   - `retained.ts` and `bounded-store.ts` in `messages/` are misfiled, since neither is message logic.
   - "Re-emits session events" does not say which events or how.

## Verdict

**Ranking:** Plan 3, then Plan 2, then Plan 1.

**Does plan 3 reach 7?** Plausibly. My odds are about even, because Locality 6 is the cap and the overall may not exceed it by more than one. The single change that most raises the odds: move `SmppClient`'s bound-session wait and unwritten-only retry out of `client/client.ts` into a file of their own (plan 1's `client/next-link.ts` shape) with its `Invariant:` paragraph. `client.ts` is then only composition and state carried across links, and the unit the panel will name next is small and marked. Dropping A3 comes second.

**Structure or intrinsic difficulty?** Structure, including the structure the public contract forced. Every unit the rounds named was one the code created, not the protocol:
- the held-message timing contract;
- `LinkLife`'s predicates and its duplicate stop flag;
- `ExpiringGroups` leaving its bounds to its callers;
- one answer enforced jointly by two files.

The truly hard SMPP parts are few and can be kept in one place each: segments answered on arrival, the drain's two budgets, retrying only what never reached the socket, `data_coding` groups and operator receipt spellings. A 7 allows exactly that. The first two rounds failed because internals were rearranged under a contract that pinned the hard spot in place. The later rounds each removed a created unit and exposed the next one. Nothing yet shows that SMPP itself caps the scores at 6.

PLAN1 helps=marginal nav=6 loc=6 shape=6 self=6 overall=6
PLAN2 helps=marginal nav=6 loc=6 shape=7 self=6 overall=6
PLAN3 helps=yes nav=7 loc=6 shape=7 self=7 overall=7
