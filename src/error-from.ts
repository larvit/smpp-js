/** Whatever was thrown or rejected, as an Error. `String()` throws on some values; this cannot. */
export function errorFrom(reason: unknown): Error {
	if (reason instanceof Error) return reason;

	try {
		return new Error(String(reason));
	} catch {
		return new Error('A thrown value that cannot be converted to a string');
	}
}

const printable: readonly string[] = ['boolean', 'number', 'string'];

/** String() throws on a null-prototype object or a symbol, so those are named by type instead. */
export function namedValue(value: unknown): string {
	return printable.includes(typeof value) ? String(value) : typeof value;
}
