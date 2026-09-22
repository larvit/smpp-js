# todo.md

Remaining work for `@larvit/smpp`. Read [README.md](README.md)'s goals and [AGENTS.md](AGENTS.md)'s
hard rules first — they constrain every item below.

This is a working file that sets its own rules. The documentation conventions in AGENTS.md do not
govern it, and nothing here is a source anything else may cite.

## Status

The rewrite is **feature complete and green**: the suite, lint and typecheck are clean on Node 18
to 26, and 0.5.0 is on npm. 0.6.0 is next, and it is a quality cut rather than a feature one — the
comprehension gate and the defects under [0.6.0](#060) come first, then the gaps a comparison with
other SMPP libraries found.

## The agreed API

Settled with the maintainer before implementation. Do not change any of it without asking. The
public surface is documented in [README.md](README.md); this is the short form.

```ts
import { client, server } from '@larvit/smpp';

const { err, session } = await client({ host, password, port, username });
const { err: sendErr, pduObjs, smsIds } = await session.sendSms({ dlr, from, message, to });
await session.unbind();

const { err: serverErr, server: smpp } = await server({ authenticate, port });
smpp.on('session', session => {
	session.on('sms', async sms => {
		await sms.sendResp();
		if (sms.dlr) await sms.sendDlr('DELIVERED');
	});
});
await smpp.close();
```

Rules the API follows:

- **Never throws.** Everything fallible resolves to `{ err?, … }`. See AGENTS.md rule 1.
- **Named exports only**, no default export. `defs` is exported as a group alongside the individual
  tables.
- **The PDU codec is synchronous** and returns `{ err?, pduObj? }` / `{ err?, buffer? }`.
- **Low-level surface stays public**, including `session.sock`, `session.send()` and
  `session.sendReturn()`.

## Done

| | Covered by |
| --- | --- |
| Definition tables: constants, errors, encodings, wire types, TLVs, commands | `test/encodings.test.ts`, `test/types.test.ts`, `test/commands.test.ts` |
| Message helpers: splitting, bit counting, SMPP dates and times | `test/message.test.ts` |
| PDU codec: parse, build, respond, per-command typing, bounds checks | `test/pdu.test.ts` |
| Stream framing | `test/pdu-framer.test.ts` |
| Delivery receipt parsing, TLV and text | `test/dlr.test.ts` |
| Session, client, server: bind, auth, send, reassembly, DLRs, timeouts, abort, send window | `test/session.test.ts` |
| Merged multipart DLRs including across a reconnect, reassembly bounds, per-send abort, the segment cap | `test/session-extras.test.ts` |
| `smsIdFormat`: a peer's `submit_sm_resp` and receipt ids read into one notation before they are compared | `test/dlr.test.ts`, `test/session-extras.test.ts` |
| A draining `close()` and `unbind()`, bounded by `shutdownTimeout` or an abort | `test/session-extras.test.ts` |
| A drain that also waits out the messages the application has not answered, with `sendDlr()` the one send that passes it | `test/session-extras.test.ts` |
| `OutgoingRequests`: the gate, the window, the pending map and the retry under one owner, told when a link comes up or goes down | `test/session-extras.test.ts`, `test/session.test.ts` |
| Held messages capped and expiring, so an application that answers nothing cannot grow them | `test/session-extras.test.ts` |
| A send with no link held for the next one, and one the link dropped under counted as `unanswered` | `test/session-extras.test.ts` |
| A message whose link dropped refused an answer, with its receipt still allowed out | `test/session-extras.test.ts` |
| The hold released exactly when the peer was answered: a refused `sendResp()` keeps it, a listener that rejected drops it | `test/session-extras.test.ts` |
| Every runnable README example | `test/readme.test.ts` |
| Receipt-versus-message classification by `esm_class` | `test/dlr.test.ts`, `test/session.test.ts` |
| An intermediate delivery notification read as a report marked `intermediate`, as is a receipt reporting `ENROUTE` or `SCHEDULED`, and never counted into a merge | `test/dlr.test.ts`, `test/session.test.ts`, `test/session-extras.test.ts` |
| A transient state sent under the marker the spec gives it, off the same list the reader uses | `test/session-extras.test.ts` |
| A listener that throws, or rejects, reaching `sessionError`/`serverError` rather than the process | `test/session.test.ts`, `test/error-from.test.ts` |
| Cross-checked against node-smpp both ways and over a live session | `test/interop.test.ts` |
| CI on Node 18 to 26, Renovate, tag-triggered publish | `.gitea/workflows/` |

Every defect listed in the AGENTS.md table has a regression test naming the behaviour.

## Move the repository to Gitea

`gitea.larvit.se/larvit/smpp-js` is the repository. `github.com/larvit/smpp-js` mirrors it and is the
place issues are filed. Maintainer's calls, 2026-09-13 and 2026-09-14.

- [x] `larvit/smpp-js` holds `main`, from `typescript`, and `v0.4.0`, from `master`. `rewrite-base`
      and the `renovate/*` branches stayed behind.
- [x] Fast-forward is the only merge style. `main` takes no pushes, requires `Test / lint
      (pull_request)` and `Test / test (*) (pull_request)`, blocks an outdated branch, and gives
      admins no override. Every other branch takes force pushes.
- [x] The workflows are in `.gitea/workflows/`. Tests run on pull requests only, the event the gate
      reads; Renovate runs as a scheduled workflow, as on adf-codec.
- [x] The release publishes without provenance, which npm generates only on GitHub Actions and
      GitLab CI/CD.
- [x] `package.json` names Gitea, and the GitHub mirror's issues as `bugs`. The README links
      absolutely: npmjs.com resolves a relative link against itself when the `repository` is not on
      GitHub. Its test badge is gone, since Gitea reports a workflow's status per branch and no
      workflow runs on `main`.
- `RENOVATE_GITHUB_TOKEN` exists nowhere, so Renovate queries github.com unauthenticated, as
  adf-codec's nightly run already does without a warning. `RENOVATE_TOKEN` is the Gitea token and
  cannot stand in for it. Add a github.com token only if lookups hit the rate limit.

## Before publishing 0.5.0

- [x] 0.5.0 rather than 1.0.0, while usage is this low. Maintainer's call, 2026-09-14.
- [x] `NPM_TOKEN`, which `.gitea/workflows/release.yaml` needs, is a Gitea organization secret.
- [x] Tag `v0.5.0` on Gitea to publish. The first publish creates `@larvit/smpp` on npm, provided the
      token can publish under `@larvit`.
- [x] `npm deprecate larvitsmpp` pointing at `@larvit/smpp`. Maintainer's call to run it; not
      something CI should do.

## Retire the GitHub repository

Nothing here starts before 0.5.0 is published. Maintainer's call, 2026-09-14. Then in this order:
deleting GitHub's old branches closes every pull request based on them without a reply, and GitHub
refuses to delete its default branch.

- [x] Close the backlog below.
- [x] Close [#71](https://github.com/larvit/larvitsmpp/pull/71), pointing at Gitea.
- [x] Rename `larvit/larvitsmpp` to `larvit/smpp-js`. GitHub redirects the old URLs, and the `bugs`
      URL in `package.json` resolves from then on.
- [x] Push `main` and make it GitHub's default branch.
- [x] Renovate is Silent for this repository in the Mend Developer Portal, so it opens nothing on
      GitHub while the organization-wide installation stays. CodeRabbit stays installed.
      Maintainer's call, 2026-09-14.
- [x] Mirror to GitHub from `.gitea/workflows/mirror.yaml` and `mirror-delete.yaml`, with
      `MIRROR_GITHUB_TOKEN`. A push of a commit carrying the workflow, and the nightly run, send all of
      Gitea's branches and tags, overwriting a same-named ref; a branch or tag deleted on Gitea is
      deleted there too. Refs only GitHub has stay. Maintainer's call, 2026-09-14.
- [x] GitHub's wiki, projects and Actions are off, the Travis app and webhook are gone, and its About
      matches the package. Gitea carries the same description, website and topics, and sends issues
      to GitHub as its external tracker.

## Close the GitHub backlog

**Answer and close as fixed by 0.5.0**, the reply naming what fixed it:

- [x] [#2](https://github.com/larvit/larvitsmpp/issues/2) Tests for the README examples:
      `test/readme.test.ts`.
- [x] [#3](https://github.com/larvit/larvitsmpp/issues/3) Tests for flash messages:
      `test/session.test.ts`.
- [x] [#4](https://github.com/larvit/larvitsmpp/issues/4) DLR errors with `message_state` missing:
      `dlrFromPdu()` parses the `stat:` receipt text when the TLVs are absent.
- [x] [#13](https://github.com/larvit/larvitsmpp/issues/13) Limit a long SMS to fewer segments: the
      `maxSegments` send option.
- [x] [#16](https://github.com/larvit/larvitsmpp/issues/16) Support all three bind types: bound and
      enforced in both directions.
- [x] [#17](https://github.com/larvit/larvitsmpp/issues/17) `addr_ton`/`addr_npi` should be
      settable: `sendSms()` takes all four, documented and tested.
- [x] [#20](https://github.com/larvit/larvitsmpp/issues/20) Tests fail on current dependency
      versions: the mocha suite is gone; `node:test` on Node 18 to 26.
- [x] [#33](https://github.com/larvit/larvitsmpp/issues/33) Large inbound text arrives as raw
      `Buffer` segments: `IncomingRequests` reassembles a UDH-carrying `deliver_sm` into one `sms`
      event.
- [x] [#68](https://github.com/larvit/larvitsmpp/pull/68), a pull request: `message_id` in
      `submit_sm_resp`, spec DLR codes. All four hold: `sendResp()` always answers a `message_id`,
      per segment; `stat:UNDELIV` is the 7-character code. Credit the reporter — the fork found real
      defects.

**Close as superseded**, all against 0.4.0 dependencies the rewrite does not have — `async`,
`coveralls`, `eslint`, `iconv-lite`, `larvitutils`, `mocha`, `mocha-eslint`, `portfinder`, `uuid`:

- [x] [#40](https://github.com/larvit/larvitsmpp/pull/40),
      [#41](https://github.com/larvit/larvitsmpp/pull/41),
      [#42](https://github.com/larvit/larvitsmpp/pull/42),
      [#45](https://github.com/larvit/larvitsmpp/pull/45),
      [#46](https://github.com/larvit/larvitsmpp/pull/46),
      [#47](https://github.com/larvit/larvitsmpp/pull/47),
      [#59](https://github.com/larvit/larvitsmpp/pull/59),
      [#63](https://github.com/larvit/larvitsmpp/pull/63),
      [#64](https://github.com/larvit/larvitsmpp/pull/64),
      [#67](https://github.com/larvit/larvitsmpp/pull/67),
      [#70](https://github.com/larvit/larvitsmpp/pull/70),
      [#77](https://github.com/larvit/larvitsmpp/pull/77).
      [#70](https://github.com/larvit/larvitsmpp/pull/70) is the open `uuid` advisory GitHub reports
      on the default branch; it disappears with the runtime dependencies rather than being fixed.

[#60](https://github.com/larvit/larvitsmpp/issues/60) is Renovate's dashboard and stays open after
the rewrite, for a dependency added later. Maintainer's call, 2026-09-14.

**Close as tracked here**, the reply saying it will be implemented on Gitea:

- [x] [#8](https://github.com/larvit/larvitsmpp/issues/8) The socket's remote host and port on log
      messages: under Worth doing, not blocking. Maintainer's call, 2026-09-14.

## 0.6.0

A nine-reader comprehension panel read the whole project on 2026-09-20 and scored it 7 overall,
mean 6.8. Navigation (7–8) capped nobody. **Locality capped every unit reader at 5–6 and Shape
capped both architects at 6**, and those two are what this release lifts. The gate is 7 on all four
dimensions, higher where it is cheap. Maintainer's call, 2026-09-20. A systems-architect review the
same day returned ALIGN with one blocking-severity finding, which is the first item under Locality
and is also what the panel ranked hardest — two methods, one answer.

### Correctness, ahead of everything below

- [ ] **Take the maintainer's call on whether goal 2 covers a value we could not send as given.**
      Goal 2's four clauses are one family — an undeterminable outcome, a non-final report, a
      re-send, dropped work — and none of them covers *the wire carried a value the caller did not
      write, and the call reported success*, which is the `NaN` sender, the `sm_length: 0` body and
      `1e+21`. Items below cite goal 2 for exactly that, and the DLR-merge item concedes it "is
      stated in no file today either way". Proposed clause, after "…is not dropped": "; a call that
      reports a message as sent asserts that the wire carried what the caller wrote, so a value we
      cannot send as given is refused before anything goes out rather than coerced into one the
      caller never wrote." A goal is the maintainer's, so nothing edits README until that is
      answered. From the prose pass of #18.

- [ ] **Range-check `maxOctets` with its five siblings.** `limitsOf()` in `session-options.ts`
      covers `idleTimeout`, `maxOutstanding`, `maxReassembly`, `reassemblyTimeout`, `responseTimeout`
      and `shutdownTimeout`; `maxOctets` is documented, consumed by `Reassembler`, and absent from
      both that list and `CheckableOptions`. `server({ maxOctets: 0 })` starts, then refuses every
      multipart message and reports each as lost traffic.

- [ ] **Read `multiple` in `parseTlvs()` and `writeTlvs()`, or delete it and `tlvMap`.** Five TLVs
      declare `multiple: true` (`callback_num`, `callback_num_atag`, `callback_num_pres_ind`,
      `broadcast_area_identifier`, `broadcast_error_status`) and nothing reads it; `parseTlvs()` keys
      by tag name, so a peer sending two `callback_num` TLVs silently keeps the last. `tlvMap` on
      `broadcast_sm_resp` is declared, set once and read nowhere. This is the "Dormant filters" row
      of the 0.4.0 defect table in a new spelling — metadata that reads as a guarantee.

- [ ] **Arm the merge for the segments the SMSC did take, or say why not.** `collectSent()` sets
      `failure` if any segment errored, including the `UnansweredError` a mid-send drop produces, and
      `session.ts` only calls `dlrMerger.expect(sent.smsIds)` when `!sent.err`. So a link drop during
      a multipart send leaves per-segment `dlr` events firing while `messageDlr` never can, traced
      only by one `debug` line. `session-extras.test.ts` has the adjacent case — a drop *after* the
      send — and not this one. If goal 2 forbids reporting on a message we cannot fully account for,
      that is the answer; it is stated in no file today either way.

- [ ] **Return an `err` where `message` is not a string, rather than throwing.**
      `sendSms({ message: undefined })` — a forgotten property — reaches `value.replace()` in
      `defs/encodings.ts` through the alphabet detection `checkOptions()` runs, and the `TypeError`
      escapes `submitSms()` into the caller's process; `NaN` and `12345` do the same. README promises
      "Never throws. Every fallible call resolves to `{ err?, … }`" and AGENTS.md hard rule 1 says it
      again, so the docs are false for the likeliest caller mistake there is. From the stability
      review of #18.

- [ ] **Derive `sm_length` for a numeric body, or refuse one.** `resolveBody()` in `pdu.ts` reads the
      length only where the body is a Buffer or a string, so
      `objToPdu({ cmdName: 'submit_sm', params: { short_message: 12345 } })` writes `sm_length: 0`,
      then five octets after it, and reports success — and this library's own parser refuses what it
      built, as "TLV 12594 runs past the end of the PDU". Goals 1 and 2. From the stability review
      of #18.

- [ ] **Settle which numbers may spell a text field, refuse the rest, and say so where a consumer
      reads it.** `wantText()` takes every finite number through `String()`, so `message_id: 1e21`
      writes `1e+21`, `from: 0.1 + 0.2` writes `0.30000000000000004` and `source_addr: -5` writes
      `-5` — none of them is the id or the address the caller meant, and all three are reported as
      sent. The numeric branch exists for a digit sequence (`message_id: 123`); the product-owner
      review of #18 recommends `Number.isSafeInteger(value) && value >= 0` with the refusal naming
      the fix, since a 64-bit SMSC id loses digits to a JS number before this library ever sees it.
      Goals 2 then 3: `from: 1e21` is reported as sent to an address that reaches nobody, which is
      the wrong answer about what happened before it is laxness in what we send. That a number is
      accepted at all reaches a consumer in no sentence either: only the type comment at
      `defs/commands.ts:239`, and one CHANGELOG line that stops being visible when
      0.7.0 is cut, while README's Building bullet reads as the whole rule for a text field. Whether
      this is a supported spelling or 0.4.0 tolerance decides whether that sentence lands in
      README.md or in MIGRATION.md — write it in the same change as the rule, so it is worded once.
      From the stability and product-owner reviews of #18.

### Throughput — goal 6, and the default window is where we are slowest

- [ ] **Close the gap to jsmpp at `maxOutstanding: 10`.** Measured 2026-09-20 against the same sink,
      100,000 messages each: this library 25,358/s, jsmpp 30,771/s, Cloudhopper 27,945/s — we are
      last at the one window most callers will ever run, while leading Cloudhopper and trailing jsmpp
      by only 5% at 50 and 200. So the cost is not the codec, which the higher windows exercise just
      as hard; it is something per-request that the window hides once enough requests overlap.
      `benchmarks/` reproduces all three. Goal 6.

### Locality — 5–6 today, and the gate is 7

- [ ] **Give `IncomingRequests` a port instead of the `Session` it drives.** It holds its owner and
      calls eight members of it 18 times, including `this.session.close()` on an inbound `unbind` —
      a collaborator ending its owner's life. `OutgoingRequests` is the mirror half of the same
      boundary and takes no session at all. AGENTS.md's "Nothing reaches back up" is false because of
      this, and `docs/decisions.md` already states the rule under The session's life: "a collaborator
      that has to ask does not own its decision". It is also the missing test seam — inbound routing,
      reassembly dispatch, `onRequest` ordering and bind-direction refusal have no unit test because
      the class cannot be built without a live socket. Carry the eight members as `IncomingDeps`,
      exactly as `sendPastDrain` is carried now. No public surface changes. **Do this before the
      store (goal 9), or the back-edge is baked into the store's published interface.**

- [ ] **Route `sms.ts` through its handlers, all of it.** `createSms()` already injects
      `handlers.send`, and then reaches `sms.session.sendReturn()`, `sms.session.bindAllows()` and
      `sms.session.acceptsOptionalParams()` anyway — two channels to one collaborator. `Sms.session`
      stays public as data the application reads. The cheaper half of the item above, and the one
      that shows the shape.

- [ ] **Give the held-message protocol one name and one home.** `emitSms()` is the unit 8 of 9
      readers named and 4 would least want to modify, and every one proposed the same fix. It runs
      five mechanisms in one scope: a hold keyed by array identity, a `working` counter seeded from
      `listenerCount('sms')`, a `WeakMap` keyed by the `Sms` object, a `setImmediate`-deferred
      release, and a captured `linkGeneration` — with the counter decremented from `session.ts`'s
      `captureRejectionSymbol` in another file. A `MessageHold` owning `hold/release/listenerGaveUp`
      collapses three files into one readable object. Every way of getting it wrong is silent: a hung
      shutdown, or a receipt refused.

- [ ] **Derive `Reassembler`'s octet total instead of maintaining it at five sites.** `this.octets`
      and each `group.octets` must agree, adjusted in `collect`, `trim`, `takeOldest`, `sweep` and
      `clear`, and `collect()` discovers its own eviction by re-reading the map by identity. Push the
      budget into `ExpiringGroups` as a weighed capacity, and have `trim()` report whether the
      current group survived. Named by 6 of 9 readers.

- [ ] **Let the two address arrays size a C-Octet String through `cstring.size()`.**
      `sizeDestAddresses()` and `sizeUnsuccessSmes()` spell "len + 1" themselves, and each `offset +=`
      after a write spells it a third time, so `dest_address_array` and `unsuccess_sme_array` each
      know the cost in three places. Route both through `cstring.size()` and advance the offset by
      what it returns. That also makes `size()` refuse where `write()` already does, so the error
      arrives from the first call rather than the second; today the pair only fails closed because
      `writeParams()` and `writeTlvs()` both bail on the write. From the stability review of #16.

- [ ] **Split the two questions `OutgoingRequests.linkDown()` answers.** `Session.drain()` calls it
      twice for opposite conclusions — "nothing to drain, success" and "the link died under us,
      failure" — and `outgoing-requests.ts` reads it a third way. Two named predicates. Named by 7
      of 9 readers, who each reconstructed the ordering by hand.

- [ ] **Name `pastDrain()`'s retry condition and what makes the loop end.** The exit is a
      three-term disjunction over two collaborators, whose comment covers the first term only, and
      the method is named for what it bypasses. Do not change what it asks: `gate.isUp()` rather than
      `linkDown()` is deliberate and recorded.

- [ ] **Replace `resolveBody`'s `settles` boolean with the decision it stands for.** One boolean
      chooses both whether to overwrite `data_coding` and which params to read it from, across four
      helpers all named some abstraction of "body". Return a named source — `'short_message' |
      'payload' | 'caller'` — and branch once. Ranked hardest by three readers and picked by one as
      the unit they would least want to touch, because a mistake here does not throw, does not fail
      the types, and reaches the peer as somebody's message rendered wrong.

### Shape — 6 today, and the gate is 7

- [ ] **Group `src/` into a second level, and retire whichever record loses.** 34 files on one
      plane, where `src/defs/` at 7 proves the shape is known one level down. `docs/decisions.md`
      says "`src/` stays flat until a module has to move for another reason. Valid while that map is
      what a reader navigates by" — and both architects reported that the map is now AGENTS.md rather
      than the tree, which is that premise failing. `todo.md` already carries the opposite
      instruction under Worth doing. Two records, opposite answers; one has to go. Do it in the same
      change as the `IncomingRequests` port or the imports are rewritten twice.

- [ ] **Split `test/session-extras.test.ts` by the question each block answers.** 3,010 lines, 19
      unrelated `describe` blocks whose names are already the file names they should be. With
      `session.test.ts` it is 54% of all test code and 84% the size of `src/`. "extras" names neither
      a question nor a module — it names the rest — and AGENTS.md's own convention forbids exactly
      that. `max-lines` covers `src/**` only, so nothing has stopped it growing.

- [ ] **Collapse the three objects named `defaults`.** `client.ts`, `server.ts` and
      `session-options.ts` each export or hold one; `port: 2775` is written twice and the idle
      timeout is derived two ways to the same 40 000. "What is the default for X" has three answers
      depending on the entrypoint, and nothing fails when they drift. Named by both architects as the
      most likely first bug a new contributor ships.

- [ ] **Rename `EncodingName`'s `ASCII` to `GSM7`, with `ASCII` a deprecated alias for one minor.**
      It is GSM 03.38, where `$` is 0x02 and `@` is 0x00, and `segmentUnits.ASCII = 153` is a septet
      budget under a name that says octets. The 2026-09-09 decision removed `consts.ENCODING.ASCII`
      for exactly this reason and left the option's own vocabulary carrying it. Pre-1.0 the minor is
      the breaking unit, so this is as cheap as it will ever be, and `todo.md` already requires the
      `consts.ENCODING` names settled before the custom-encoding registry — this is the other half.

- [ ] **Split `session-options.ts` into the things it is.** Option types and their validator, the
      `SessionEvents` map, and the bind-direction rules (`bindCommands`, `bindTypeFromCommand`,
      `standsInFor`, `bindCarries`) are three questions in one file, and the `defaults` table mixes
      option defaults with four hard bounds that are not options. Both architects named it as where
      the codebase rots first: at 34-wide it is where anything session-shaped lands.

- [ ] **Name the base-versus-segment distinction in the message id types.** `Sms.smsId` is a base,
      `sendSms().smsIds[]` are segment ids, `Dlr.smsId` is a segment id and `MessageDlr.smsId` is a
      base again — four fields, one type, `string`. The whole multipart receipt mechanism turns on
      telling them apart and only `parseSegmentId()` knows.

### Self-sufficiency — 6–7 today, and the gate is 7

- [ ] **Move the one-line facts out of the decision log and back to the code.** Five of nine readers
      independently reported being sent to `docs/decisions.md` for a question they hit while reading,
      with no link from the code; one counted roughly fifty index redirects. The four worth inlining
      as one line each: that `segmentUnits`' three numbers are in two units (septets and octets),
      which body settles `data_coding`, that a receipt's body is read as octets whatever its
      `data_coding` says, and the `<base>-<n>` id notation. The reasoning stays in the log; the
      definition belongs at the code.

- [ ] **Document the two delivery-receipt merge bounds.** `maxDlrMerges` (1000) and
      `dlrMergeTimeout` (24 h) are hardcoded, are not options, and appear in no README and no test —
      while README states the equivalent held-message bounds explicitly ("Neither bound is an
      option"). A sender with more than 1000 concurrent multipart `dlr: true` messages silently
      evicts the oldest at `warn`. The inherited architect hit this on the 3am walk.

- [ ] **Add a ten-line SMPP glossary to the README.** Both juniors and the no-domain mid reported
      the same largest cost: nothing in the repo says what a PDU, `esm_class`, `data_coding`, TON/NPI
      or `submit_sm`-versus-`deliver_sm` are, and the inline spec citations mark a rule without
      stating it. One of them put it at a third of their reading time. Four commands, three octets,
      one sentence each.

### Doc claims this review falsified

- [ ] **Make "every README example is executed by the suite" true, or stop claiming it.** Goal 10 and
      the Done table both promise it; `test/readme.test.ts` transcribes the examples by hand and has
      drifted — 15 fenced `javascript` blocks in the README against 10 tests, and the test named "the
      documented sending options" passes none of the five options the README's example passes. Read
      the fenced blocks at test time and assert each appears verbatim in the executed source, so an
      edit to either fails the gate.

- [ ] **Correct AGENTS.md's "Nothing reaches back up".** False while `IncomingRequests` holds a
      `Session`: either the first Locality item makes it true, or the sentence names the exception
      until it does.

- [ ] **Narrow the `src/defs/*` lint exemption to the four table files.** Its stated reason — "the
      spec tables are data: their length tracks the specification, not any complexity" — is false for
      `defs/types.ts`, which is 595 lines of wire codec with 25 functions and is the file that parses
      hostile input from the network. It carries more over-budget methods than any other file in the
      repo, under a suppression written for something else.

- [ ] **Run the interop suite before cutting a minor, and date the claim.** README states
      "Interoperable. Tested as a client against Jasmin and SMPPSim, and as a server against Kannel,
      jsmpp, Cloudhopper, python-smpplib and php-smpp" in the present tense; `interop-tests/README.md`
      is honest that the run was 2026-09-08. Nothing runs the peers on a schedule or before a tag, so
      the claim rots silently. Goals 1 and 9.

## Worth doing, not blocking

- [ ] **Cut the three teardown sentences `test/teardown.ts` already says.** Under AGENTS.md's
      Conventions, "`test/teardown.ts` covers a session, a server and a listener" restates its two
      exported names, "Its close aborts rather than drains" restates `closeAfter`'s own doc comment,
      and the `net.Server.close()` sentence restates `closeListenerAfter`'s. Keep the registered-at-
      creation rule and the FIFO one, which nothing else states, and drop "CI's ten-minute cap" —
      that number lives in `.gitea/workflows/test.yaml`. Raised by the prose pass, 2026-09-20.

- [ ] **Leave AGENTS.md hard rule 1 the rule, and the decision log its reasoning.** Rule 1's fourth
      sentence — "a function whose argument types are a closed set is guarded by the compiler and
      stays total, which is why the encoding helpers return plainly, and the check belongs at
      whichever boundary the argument arrives untyped at" — is the reasoning of the
      `bitCount()`/`encodeMessage()`/`splitMessage()` entry in `docs/decisions.md`, which AGENTS.md's
      own Documentation section makes a defect: it scopes AGENTS.md to an index of the decisions. It
      also reads two ways — "wherever the types admit one" as an exemption for a typed field,
      "the check belongs at whichever boundary the argument arrives untyped at" as a requirement at
      `sendSms()` — and the `message` `TypeError` item sits exactly between them, so one rewrite
      settles both. Maintainer's call, since it changes what a hard rule asks. From the prose pass
      of #18.

- [ ] **Refuse a delay Node's timers cannot hold, in `checkLimits`.** `idleTimeout`,
      `reassemblyTimeout`, `responseTimeout` and `shutdownTimeout` take any integer, and `setTimeout`
      fires after 1 ms for anything above 2147483647 — so a value in the wrong unit gets the inverse
      of what it asked for, explained only by a warning on stderr. `connectTimeout` refuses one
      already, which is the asymmetry to close. The same four print an untyped value bare, so
      `idleTimeout: '5000'` is refused with `got 5000` — a value the reader reads as correct — where
      `connectTimeout` quotes it. `namedValue()`'s four sites — `messagingMode`, `encoding`, the time
      options and `smsIdFormat` — are the same defect once more: there `true` and `'true'` both print
      as `true`. One fix closes all three, and `valueText()` in `defs/types.ts` is the quoted
      spelling to take it from. Raised by review, 2026-09-20.

- [ ] **A send the codec will refuse waits for a link and a window slot first.** `refuse()` in
      `outgoing-requests.ts` runs `misuse()` and the abort check before the wait, precisely so a call
      that can never go out does not queue for what it will never use; a body `objToPdu()` refuses on
      every attempt is the same case, and #98 made it a common one. On a down link the caller waits
      `responseTimeout` and is told the link failed rather than that the body could not be built —
      goal 2's wrong answer about what happened. The cheap fix builds the PDU twice, so the shape is
      the open half. Raised by the architecture review of
      [#98](https://github.com/larvit/larvitsmpp/pull/98), 2026-09-09.

- [ ] **`message.ts` answers two questions.** Message coding and the SMPP time format (`smppDate`,
      `smppTime`) share the file, which the architecture map in AGENTS.md already spells out as four
      concerns. Nothing is wrong today; if the file has to move for another reason, `smpp-time.ts` is
      the split. Raised by the architecture review of
      [#98](https://github.com/larvit/larvitsmpp/pull/98), 2026-09-09.

- [ ] **A gate that refuses a floating version anywhere in the repo.** Maintainer's ask on
      [#71](https://github.com/larvit/larvitsmpp/pull/71), 2026-09-06, on the `release.yaml`
      pinning thread. Pinning every action and runner by hand is what the ask followed; the gate is
      what keeps them pinned. It has to cover workflow `uses:` and `runs-on:`, compose `image:`, and
      Dockerfile `FROM`, and the conventions differ per kind — actions take a semver tag, images the
      full patch version — so one grep for `latest` is not it.

- [ ] **A gate that fails when the test matrix misses the current Node.** Maintainer's ask on
      [#71](https://github.com/larvit/larvitsmpp/pull/71), 2026-09-06, on the Node 26 thread. Node
      26 was added by hand; nothing notices when 27 ships. Needs a source for what Current is — the
      Node release schedule is published as JSON — and a decision on whether a new Current fails the
      build or opens a PR, which is what Renovate already does for everything else here.

- [ ] **CodeRabbit reviews through the GitHub mirror.** CodeRabbit does not support Gitea, so mirror
      each Gitea pull request to GitHub for it to review there. Maintainer's ask, 2026-09-14; not
      started until asked.

- [ ] **`leftOf()` and the link gate's own budget are one concept counted twice.**
      `idle-waiters.ts` reads what is left of a budget as `Math.max(1, deadline - now)`, because 0
      means "forever" there; `link-gate.ts` runs the same subtraction and calls `<= 0` expired.
      Neither is reachable from the other, so nothing can disagree today, but a reader who learns one
      and applies it to the other is wrong. A budget type both take would close it. Raised by review,
      2026-09-01.

- [ ] **`err:` on a receipt for a state that neither delivered nor failed.** `receiptText()` now
      writes `err:000` for `DELIVERED` and for the two transient states, and `err:001` for every
      other — so `ACCEPTED`, `SKIPPED`, `UNKNOWN` and `DELETED` still announce an error code the SMSC
      never had. Which of those are failures is the open half. Raised by review, 2026-09-03; needs a
      decision.

- [ ] **`once()` is copied into four test files, and two copies never give up.**
      `session-extras.test.ts` and `readme.test.ts` reject after 5000 ms; `session.test.ts` and
      `tls.test.ts` wait forever, so an event that never fires still hangs the run the way an
      unclosed listener used to. One shared, guarded copy closes the rest of that class.

- [ ] **The peer's address and bind on every session log message.** `remoteAddress` and `remotePort`
      reach only `server - incoming connection`, and `systemId` only the bind messages, so with
      several peers connected one session's lines cannot be told apart, and a reconnect leaves nothing
      stable to filter on. Carrying them in every session message's metadata is a change to every
      call site. From [#8](https://github.com/larvit/larvitsmpp/issues/8), closed there as tracked
      here; maintainer's call, 2026-09-14.

- [ ] **A peer whose message ids share one base logs a refused merge on every send.** `smsc01-000123`
      and `smsc01-000124` carry the same base, so `DlrMerger` merges the first message and refuses
      every one after it, one log line per send. Left at `info` — nothing the operator can fix is
      wrong — but a rate guard or silence may suit it better. Raised by review, 2026-08-30.

- [ ] **`submit_multi` and the broadcast commands** encode and decode, but nothing exercises them
      end to end. The interop suite is the natural place.
- [ ] **Move to TypeScript 7** once `typescript-eslint` supports it; `renovate.json` pins TypeScript
      below 6.1 for exactly that reason.
- [ ] **An `onReceipt` hook.** Receipt text is only loosely specified and operators disagree on it,
      but `dlrFromPdu()` is wired into `IncomingRequests` with no seam of its own: an application
      facing a format we do not parse has to take the whole PDU on `onRequest` and reimplement the
      dispatch, which owns the response as well.
      Mirror the `onRequest` seam — return a `Dlr` to own the receipt, `undefined` to fall through
      to the built-in parser.

## Gaps against other SMPP libraries

From comparing 0.5.0 with `smpp`, `@semyonf/smpp`, `@leissner/node-red-smpp`, `node-smpp-next`,
`smpp-js-sdk`, `smppjs`, cloudhopper-smpp, jsmpp, go-smpp, Kannel, Jasmin and php-smpp, 2026-09-14.
Each lands under goal 7: an option or a hook, with the call that passes none unchanged.

### Sending

- [ ] **A limiter hook, with a messages-per-second cap built on it.** Maintainer's call, 2026-09-14,
      reversing the earlier decline: Kannel, Jasmin, go-smpp and `smpp-js-sdk` all limit throughput.
      Count PDUs, not `sendSms()` calls — a long message is one `submit_sm` per segment and the
      operator counts those, which an application wrapping `sendSms()` cannot see. The hook takes a
      limiter the application already runs; the built-in cap counts per session until the store at the
      bottom lets it span sessions and processes. The default stays uncapped. Open: the hook's shape (a
      wait that resolves when a PDU may go, cut short by the send's `signal`), which requests it gates
      — messages, never `enquire_link`, `unbind` or a response — and whether its wait counts against
      `responseTimeout`.

- [ ] **Back off and resend on `ESME_RTHROTTLED`.** The SMSC refused the PDU, so resending cannot
      duplicate it and goal 2 holds, and the retry needs nothing wider than the session. Needs a
      decision: on by default with a bounded budget, as goal 5 suggests, and whether `ESME_RMSGQFUL`
      counts too. A throttled answer is also what a limiter hook wants to hear about.

- [ ] **`sendSms()` takes the rest of `submit_sm`.** `service_type`, `priority_flag`, `protocol_id`,
      `replace_if_present_flag` and TLVs on every segment, and `registered_delivery` beyond final
      receipts: on failure only, and intermediate notifications. Today each needs `send()`, which gives
      up splitting, the alphabet checks and receipt merging. TLVs are the common case: India's DLT
      rules put `PE_ID` (0x1400) and `TEMPLATE_ID` (0x1401) on every `submit_sm`, and USSD rides on
      `ussd_service_op`. Refuse a TLV the send composes itself (`sar_*`, `message_payload`). Open: one
      spelling for receipts, since `dlr: true` and a raw `registered_delivery` could disagree, and
      whether goal 4's rule on optional parameters binds a TLV the caller named.

- [ ] **Choose how a long message is spelled on the wire.** Only an 8-bit UDH reference goes out
      (`message.ts`), though the reader takes a 16-bit UDH, `sar_*` and `message_payload` alike. Some
      SMSCs take only `sar_*` or `message_payload`; php-smpp offers all three. A 16-bit reference also
      makes a collision rarer: the 8-bit one wraps every 255 sends on a session.

- [ ] **Failover across SMSC hosts.** Maintainer's call, 2026-09-14. `client()` takes one `host` and
      `port`; Kannel, Jasmin and php-smpp take several. A list the reconnect loop walks holds only
      which host the one session is on, so it needs no store. Two options, both maintainer's calls:
      - **Order**, `fixed` or round robin, default `fixed`. Fixed starts every reconnect at the first
        host; round robin at the host after the one the link was last on.
      - **Starting over**, a boolean, default on: once the last host has been tried, go back to the
        first. Off ends the session once the last host fails, as a drop does under `reconnect: false`.
      Open: how the list and today's `host` and `port` share one spelling; whether the backoff grows
      per host or per pass; and whether round robin with starting over off still tries the hosts
      before the one it started at.

### The server

- [ ] **`sendSms()` on a `server()` session sends `submit_sm` toward the ESME.** Kannel answers
      `ESME_RINVCMDID` (`interop-tests/kannel.test.ts`, "MO to Kannel"), and goal 1 says that PDU never
      goes out. A server has no other way to send an MO message either: `sendMo()` in that test builds
      one from `submitSmParams()` and `ConcatReference`, neither exported. Choosing `deliver_sm` by
      `linkEnd` gives MO messages the splitting and checks, keeps one method for one goal, and refuses
      the options 3.4 has `deliver_sm` leave empty (`scheduleDeliveryTime`, `validityPeriod`).

- [ ] **Error TLVs on a response this library builds.** `buildBody()` in `pdu.ts` writes no body for
      any non-zero status, so a server cannot answer a `data_sm` with `delivery_failure_reason`,
      `network_error_code` or `additional_status_info_text`, and a 5.0 peer gets none of its error TLVs.
      3.4 omits the body on error for `submit_sm_resp` by name; read each response's section before
      widening it. Reading needs nothing: an error response carrying a body already parses.

- [ ] **PROXY protocol on `server()`.** Behind HAProxy or an AWS NLB every session's remote address is
      the balancer's, so `authenticate` cannot allow-list by IP and logs name the wrong peer. v1 is
      text; v2 is binary and the only one an NLB sends. `smpp` accepts v1 from anyone; accept either
      only from addresses the option names.

- [ ] **`outbind`.** In the command table, handled nowhere: a client cannot take an SMSC's `outbind`
      and bind back, and `server()` cannot send one. Rare; take it on with a peer that uses it.

- [ ] **Register vendor-specific commands.** 3.4 reserves `command_id` `0x00010200`–`0x000102FF` for
      SMSC vendors; today one arrives as a `PduRefusedError`. `smpp` has `addCommand()`. The same
      shape question as registering an encoding.

### Encodings

- [ ] **Register a custom encoding.** Maintainer's ask, 2026-09-14. `EncodingName` is a closed union
      of three (`defs/encodings.ts`). An entry needs a name, a `data_coding`, `encode`, `decode`,
      `match`, whether `detect()` may pick it, and enough for `splitMessage()` to budget a segment
      without halving a character. Take encodings as a client or server option rather than mutating a
      module table as `smpp` does, so two sessions in one process cannot disagree about a name. A taken
      name is an `err`. Settle `consts.ENCODING`'s names first. An entry may claim a `data_coding` a
      built-in already uses, maintainer's call, 2026-09-14: an SMSC whose default alphabet, 0x00, is
      Latin-1 needs Latin-1 written and read under it
      ([#23](https://github.com/larvit/larvitsmpp/issues/23)). The entry then owns that coding on its
      session both ways: `encodingByDataCoding()` resolves to it, `detect()` tries it in the
      built-in's place, and naming the displaced built-in is an `err` naming the entry. Two entries
      on one coding are an `err`. Settle whether a claim on 0x00 reaches the class groups
      `messageClassEncoding()` reads GSM 7-bit from, which `flash` writes under.

- [ ] **The alphabets SMPP 3.4 names that no encoding carries.** `consts.ENCODING` lists the
      `data_coding` ids (5.2.19); only `ASCII`, `LATIN1` and `UCS2` can be sent. Those with a published
      definition, and what each costs:
      - 0x01 IA5 (ITU-T T.50, ASCII in practice): trivial.
      - 0x06 ISO-8859-5 (Cyrillic) and 0x07 ISO-8859-8 (Hebrew): 96-entry tables.
      - 0x05 JIS X 0208, 0x0D JIS X 0212, 0x0A ISO-2022-JP and 0x0E KS C 5601: two-octet sets.
        `TextDecoder` reads them through ICU — EUC-JP and EUC-KR once each octet's high bit is set,
        `iso-2022-jp` as is; checked for JIS X 0208 and KS C 5601 on Node 24.18.0. Nothing built in
        encodes them, so ship tables or build the reverse map on first use by decoding the 94×94 grid.
        A Node without full ICU throws from `new TextDecoder()`, which hard rule 1 wraps into an `err`.
      - 0x09 pictogram has no published definition; leave it out.

- [ ] **GSM 7-bit national language shift tables.** 3GPP TS 23.038 defines them for Turkish, Spanish
      (single shift only), Portuguese and ten Indian languages — Bengali, Gujarati, Hindi, Kannada,
      Malayalam, Oriya, Punjabi, Tamil, Telugu and Urdu — selected per message by UDH elements 0x25
      (locking) and 0x24 (single). They keep that text near GSM's segment size instead of UCS2's 67
      characters. Reading means honouring those elements in `decodeMessage()`; sending means `detect()`
      picking a table, with each element's 3 octets off the segment budget. `smpp` has Turkish, Spanish
      and Portuguese, used only when the caller writes the UDH.

- [ ] **Packed GSM 7-bit, opt-in.** Everything goes out unpacked, SMPP's convention (AGENTS.md, "GSM
      7-bit is sent unpacked"); go-smpp carries a packed codec for SMSCs that want septets. Find an SMSC
      that needs it before building it.

- [ ] **`consts.ENCODING` spells five alphabets twice.** `CYRILLIC`/`ISO_8859_5`,
      `HEBREW`/`ISO_8859_8`, `JIS`/`X_0208_1990`, `EXTENDED_KANJI_JIS`/`X_0212_1990` and
      `LATIN1`/`ISO_8859_1`; `FLASH` is a message class, not an alphabet. One name each before
      registration starts taking names. A breaking change to an export.

### Observability

- [ ] **Metrics.** Inbound traffic has `data`, `incomingPdu` and `incomingPduObj`; outbound has no
      event, and nothing counts requests in flight, queued for a window slot, waiting for a link, or
      unanswered. `smpp` and `@semyonf/smpp` emit `metrics`; cloudhopper keeps per-session counters. An
      `outgoingPdu`/`outgoingPduObj` pair mirrors the inbound events; the counters can be one read-only
      snapshot, read from the owner of each count rather than a second tally that can drift.

### Packaging, tests and CI

- [ ] **Ship `src`, so the source maps lead somewhere.** Maintainer's call, 2026-09-14. `sourceMap`
      and `declarationMap` write maps whose `sources` are `../src/*.ts`, but `files` publishes only
      `dist`, so 82 of the package's 167 files, 225 KB of its 555 KB unpacked, point at nothing. Adding
      `src` (41 files, 209 KB) makes go to definition land in the TypeScript, and lets a debugger or
      `--enable-source-maps` show it.

- [ ] **A coverage report and a floor in the gate.** `node --test --experimental-test-coverage
      --test-coverage-include='src/**' test/*.test.ts` on Node 24.18.0, 2026-09-14: 98.77% lines,
      93.85% branches, 98.28% functions. Gate at 98, 93 and 98 with `--test-coverage-lines`,
      `--test-coverage-branches` and `--test-coverage-functions`, which Node 22 and later take — a job
      of its own on 24, since the matrix runs compiled JavaScript — and add it to `main`'s required
      checks. Raise the floor as coverage rises; never lower it.

- [ ] **Mutation testing.** `@stryker-mutator/tap-runner` runs `node:test` suites and measures whether
      a test notices a change, which coverage cannot; `@semyonf/smpp` runs Stryker in CI. The session
      suites are timer-heavy, so start with the codec and the encodings.

- [ ] **A Node-RED node, as a package of its own.** `@leissner/node-red-smpp` is the only SMPP node in
      the Node-RED library, and by a read of its source it never parses a receipt and never answers the
      SMSC's `enquire_link`. Its UI is a fair list of what operators set. It builds on this package,
      never inside it.

## Declined

- **A check that warns before `MIRROR_GITHUB_TOKEN` expires.** Gitea mails no one about a failed
  scheduled run, since its Actions bot triggers those, so a nightly check would fail unseen. The
  maintainer relies on GitHub's own expiry reminders, and on the mirror's first failed push run after
  expiry, which mails whoever pushed. Maintainer's call, 2026-09-14.

- **CommonJS.** ESM only, maintainer's call reaffirmed 2026-09-14, though `node-smpp-next` ships both.
  `require()` of an ES module works unflagged from Node 20.19 and 22.12.

## An optional store

- [ ] **Pooling, and state that survives a restart, through an optional store.** Maintainer's call,
      2026-09-14. It replaces two declines — merge state surviving a restart, and a pool of sessions —
      and goal 9 was rewritten for it. Big: design before code.
      - **What it holds.** Receipts still awaited and the groups `DlrMerger` collects. Segments of a
        message already answered but not yet whole, which the peer will not send again (goal 2). The
        concatenation reference, so a restart does not reuse one. For a pool, the ids every session
        sent, since an SMSC may deliver a receipt on any bind of the account, and the
        messages-per-second budget the sessions share.
      - **What it cannot hold.** A response belongs to the link its request arrived on, so a message
        left unanswered at a restart stays unanswerable; the peer's own timeout settles it.
      - **Pooling.** Several sessions, in one process or many, behind one send: a message goes to a
        bound session with a free window slot, all its segments on that one. In one process the
        in-memory store is enough; across processes the application supplies one.
      - **The interface.** Narrow, with keys and records of the library's own making, versioned, with
        expiry: a record from an older version is read or refused, never misread, and `DlrMerger`'s
        group shape is never published (goal 8). What processes share needs an atomic operation —
        compare-and-set or increment — since get-then-set races.
      - **Adapters live elsewhere.** Redis, Postgres or SQLite stores are packages of their own; this
        one ships the interface and the in-memory store, and no runtime dependency (goal 10).
      - **When the store fails.** Open: a send whose awaited receipt cannot be recorded is refused, or
        sent and reported as undetermined (goal 2); a pool whose store is down stops, or falls back to
        memory. Either way, an application that supplied no store never waits on one.
      - **One spelling.** A store-backed cap and the limiter hook both reach a limit shared between
        processes; settle which owns that case before building the second.
