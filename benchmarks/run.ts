import { availableParallelism } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';

/** Goal 6's floors, per send window. Set GATE=1 to fail the run instead of only reporting. */
const floors: Record<number, number> = { 1: 5000, 10: 20_000, 50: 30_000, 200: 30_000 };

/** Below this, client and sink contend for one core and the windowed floors are unreachable. */
const gateCores = 4;

/**
 * Node rather than Python, unlike the repo's other standalone scripts: it spawns the two processes
 * it measures, and they must run on the same runtime this library is measured under.
 */
const concurrencies = [1, 10, 50, 200];
const count = Number(process.env.COUNT ?? 5000);

function node(script: string, args: string[] = []) {
	return spawn(process.execPath, [`${import.meta.dirname}/${script}`, ...args], {
		stdio: ['ignore', 'pipe', 'inherit'],
	});
}

async function firstLine(stream: NodeJS.ReadableStream): Promise<string> {
	for await (const line of createInterface({ input: stream })) {
		return line;
	}

	return '';
}

const sink = node('smsc-sink.ts');
const listening: unknown = JSON.parse(await firstLine(sink.stdout));

if (typeof listening !== 'object' || listening === null || !('port' in listening)) {
	throw new Error('the sink did not report a port');
}

const port = String(listening.port);
const rows: Record<string, unknown>[] = [];

for (const dlr of [false, true]) {
	for (const concurrency of concurrencies) {
		const load = node('submit-load.ts', [
			`--port=${port}`,
			`--count=${String(count)}`,
			`--concurrency=${String(concurrency)}`,
			...(dlr ? ['--dlr'] : []),
		]);
		const reported: unknown = JSON.parse(await firstLine(load.stdout));

		await once(load, 'exit');

		if (typeof reported === 'object' && reported !== null) rows.push({ ...reported });
	}
}

sink.kill('SIGTERM');
await once(sink, 'exit');

process.stdout.write(`\n${'dlr'.padEnd(6)}${'window'.padEnd(9)}${'msgs/s'.padEnd(10)}seconds\n`);

for (const row of rows) {
	const dlr = String(row.dlr).padEnd(6);
	const window = String(row.concurrency).padEnd(9);
	const rate = String(row.perSecond).padEnd(10);

	process.stdout.write(`${dlr}${window}${rate}${String(row.seconds)}\n`);
}

const cores = availableParallelism();

process.stdout.write(`\n${String(cores)} cores\n`);

if (process.env.GATE !== '1') process.exit(0);

if (cores < gateCores) {
	process.stdout.write(`refusing to gate on ${String(cores)} cores; goal 6 states four or more\n`);
	process.exit(1);
}

const short = rows.filter(row => {
	const floor = floors[Number(row.concurrency)];

	return floor !== undefined && Number(row.perSecond) < floor;
});

for (const row of short) {
	const floor = String(floors[Number(row.concurrency)]);

	process.stdout.write(`below goal 6: window ${String(row.concurrency)} ran ${String(row.perSecond)}/s, floor is ${floor}\n`);
}

process.exit(short.length === 0 ? 0 : 1);
