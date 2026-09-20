/**
 * Drives a peer's HTTP control surface through the same load the local driver runs, so the number
 * that comes back is that library's own rate against our sink rather than ours against theirs.
 */
function arg(name: string, fallback: string): string {
	const found = process.argv.find(one => one.startsWith(`--${name}=`));

	return found === undefined ? fallback : found.slice(name.length + 3);
}

const driver = arg('driver', 'http://jsmpp:8080');
const count = arg('count', '20000');
const concurrency = arg('concurrency', '50');

async function call(path: string): Promise<unknown> {
	const response = await fetch(`${driver}${path}`);

	return response.json();
}

// Cloudhopper's window defaults to 1 and is set at bind, so threads alone would serialise it.
const bound = await call(`/bind?systemId=bench&password=benchpw&windowSize=${concurrency}`);

if (typeof bound !== 'object' || bound === null || !('ok' in bound) || bound.ok !== true) {
	process.stdout.write(`${JSON.stringify({ bind: bound })}\n`);
	process.exit(1);
}

const loaded = await call(`/load?count=${count}&concurrency=${concurrency}`);

process.stdout.write(`${JSON.stringify(loaded)}\n`);

await call('/unbind');
