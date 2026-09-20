import { client } from '../src/client.ts';

/**
 * Pushes `count` single-segment messages and reports what the wire carried per second. Keeps
 * `concurrency` sends in flight so the send window, not the caller, is what bounds the rate.
 */
function arg(name: string, fallback: string): string {
	const found = process.argv.find(one => one.startsWith(`--${name}=`));

	return found === undefined ? fallback : found.slice(name.length + 3);
}

const host = arg('host', '127.0.0.1');
const port = Number(arg('port', '2775'));
const count = Number(arg('count', '2000'));
const concurrency = Number(arg('concurrency', '20'));
const message = arg('message', 'benchmark');
const dlr = process.argv.includes('--dlr');
const username = arg('username', 'user');
const password = arg('password', 'pass');

const { err, session } = await client({
	host,
	maxOutstanding: concurrency,
	password,
	port,
	responseTimeout: 60_000,
	username,
});

if (err) {
	process.stdout.write(`${JSON.stringify({ error: err.message })}\n`);
	process.exit(1);
}

// Narrowing from the guard above does not reach into worker(), which runs after it.
const bound = session;

let issued = 0;
let failed = 0;
let unanswered = 0;

async function worker(): Promise<void> {
	while (issued < count) {
		issued++;

		const sent = await bound.sendSms({ dlr, from: 'BENCH', message, to: '46709771337' });

		if (sent.err) failed++;

		unanswered += sent.unanswered;
	}
}

const started = process.hrtime.bigint();

await Promise.all(Array.from({ length: concurrency }, () => worker()));

const seconds = Number(process.hrtime.bigint() - started) / 1e9;

process.stdout.write(`${JSON.stringify({
	concurrency,
	count,
	dlr,
	failed,
	perSecond: Math.round(count / seconds),
	seconds: Number(seconds.toFixed(3)),
	unanswered,
})}\n`);

await bound.close({ signal: AbortSignal.abort() });
process.exit(0);
