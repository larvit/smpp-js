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

Jasmin routes and persists where the sink does neither, so the gap is not an efficiency ratio
between two comparable things — what it establishes is that this library is not the bottleneck
against a production SMSC, by more than an order of magnitude. SMPPSim's store fills at roughly a
thousand messages and it then refuses the rest, so it cannot be loaded; that is a property of the
simulator, not a result.

`smppload`, the one purpose-built SMPP load generator among the peers, is blocked by a bind defect
of its own ([findings/07-load.md](../interop-tests/findings/07-load.md)), so no third-party load
tool drives these numbers.
