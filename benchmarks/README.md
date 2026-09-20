# Benchmarks

What this library sustains, and against what. Run them before setting or changing a scale goal.

```bash
docker compose run --rm node node benchmarks/run.ts              # this library, both ends
COUNT=100000 docker compose run --rm node node benchmarks/run.ts # longer, steadier
```

`run.ts` spawns `smsc-sink.ts` — a server that answers every `submit_sm` `ESME_ROK` and stores
nothing — and drives it with `submit-load.ts` at four window sizes. Point `submit-load.ts` at any
SMSC to compare:

```bash
docker compose -f compose.yaml -f interop-tests/compose.jasmin.yaml run --rm node \
	node benchmarks/submit-load.ts --host=jasmin --port=2775 --username=esme1 --password=esme1pw \
	--count=20000 --concurrency=50
```

`GATE=1` fails the run when a window falls under goal 6's floor, and refuses to judge at all on
fewer than four cores.

**A short run measures the JIT, not the library.** At 2,000 messages per point the same build
reported 16k/s where 100,000 messages reported 40k/s. Give each point several seconds.

**Cores matter, though the library is single-threaded.** The run is two Node processes, and past
them V8 marks and compiles on threads of its own while the kernel carries loopback TCP. Window 200,
100,000 messages:

| Cores | msgs/s |
| --- | --- |
| 1 | 20,476 |
| 2 | 29,603 |
| 4 | 32,869 |
| 8 | 40,046 |

A window of 1 is unmoved by any of it (7,280–8,659 throughout) because it waits on the round trip
rather than the CPU. The windowed figures are for the pair: one process alone reaches about half.

## Results, 2026-09-20

Single host, 8 cores, Node 24.18.0 in the project container, loopback. Client and SMSC are separate
processes competing for the same CPUs, so these are a floor for split hosts.

`maxOutstanding` is the send window, and it is the setting that matters most:

| Window | msgs/s | with `dlr: true` |
| --- | --- | --- |
| 1 | 7,385 | 7,289 |
| 10 (default) | 25,358 | 24,282 |
| 50 | 37,125 | 37,502 |
| 200 | 40,046 | 39,730 |

Requesting delivery receipts costs nothing measurable at any window. A window of 1 — one request in
flight at a time — costs 5x, which is the round trip rather than the codec.

Against real peers, same driver, window 50, 20,000 messages:

| SMSC | msgs/s | failed |
| --- | --- | --- |
| this library's sink | 37,125 | 0 |
| Jasmin 0.10 | 2,207 | 0 |
| SMPPSim 3.0.0 | — | 19,000 of 20,000 |

## Against the other client libraries

Same sink, same 100,000 single-segment messages, same host. This is the comparison that means
something: every client is measured pushing into *our* server, so the server's work is common to all
three and only the client differs.

```bash
docker compose -f compose.yaml -f benchmarks/compose.jsmpp.yaml up -d --build
docker compose -f compose.yaml -f benchmarks/compose.jsmpp.yaml run --rm node \
	node benchmarks/peer-load.ts --driver=http://jsmpp:8080 --count=100000 --concurrency=50
```

| Window | this library | jsmpp 3.0.3 | Cloudhopper 5.0.10 |
| --- | --- | --- | --- |
| 10 | 25,358 | 30,771 | 27,945 |
| 50 | 38,675 | 40,934 | 32,384 |
| 200 | 40,046 | 42,105 | 25,497 |

**We are slowest at the default window**, which is the setting most callers will ever run — 25,358
against jsmpp's 30,771. That is the throughput work worth doing, and it is worth doing there.

Two things the table does not show. This library does it on one event loop where both Java peers
spend one OS thread per in-flight request, which is why Cloudhopper falls off at 200 threads and we
do not. And all three are pushing into the same Node sink, whose own cost is in every number, so the
differences between clients are compressed rather than exaggerated here.

Kannel is absent deliberately: it is a gateway rather than a client library, wired here as an ESME
that forwards from its own spool, so loading it would measure its HTTP frontend and queue rather
than an SMPP client. The number would not belong in this table.

Jasmin routes and persists where the sink does neither, so the gap is not an efficiency ratio
between two comparable things — what it establishes is that this library is not the bottleneck
against a production SMSC, by more than an order of magnitude. SMPPSim's store fills at roughly a
thousand messages and it then refuses the rest, so it cannot be loaded; that is a property of the
simulator, not a result.

`smppload`, the one purpose-built SMPP load generator among the peers, is blocked by a bind defect
of its own ([findings/07-load.md](../interop-tests/findings/07-load.md)), so no third-party load
tool drives these numbers.
