/**
 * Either a failure carrying err, or a success carrying T. Both branches declare every key, so
 * callers can destructure once and let `if (err)` narrow what is left.
 */
export type Result<T> =
	| ({ err: Error } & Partial<Record<keyof T, undefined>>)
	| ({ err?: undefined } & T);

export type VoidResult = { err?: Error };

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

/** String() throws on a null-prototype object, so anything but these is named by its type. */
export function namedValue(value: unknown): string {
	return printable.includes(typeof value) ? String(value) : typeof value;
}

/** A value named in an error: a string quoted, anything else as `namedValue()` names it. */
export function quoted(value: unknown): string {
	return typeof value === 'string' ? JSON.stringify(value) : namedValue(value);
}
