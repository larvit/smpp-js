import type { PduObject } from './codec/pdu.ts';
import type { Result, VoidResult } from './result.ts';
import type { Session } from './session/session.ts';
import type { SmppLog } from './log.ts';
import type { SmsIdFormat } from './protocol/message-ids.ts';
import type { Socket } from 'node:net';
import { isSmsIdNotation, smsIdNotations, smsIdPlaces } from './protocol/message-ids.ts';
import { namedValue, quoted } from './result.ts';

export type SendOptions = { signal?: AbortSignal | undefined };

/** An already-aborted signal skips the drain; one that fires during it cuts the wait short. */
export type CloseOptions = { signal?: AbortSignal | undefined };

/**
 * First refusal on every incoming request. Returning true means the hook answered it and the
 * built-in handling is skipped — this is how the server owns bind without the session also
 * replying "invalid command".
 */
export type OnRequest = (session: Session, pduObj: PduObject) => Promise<boolean> | boolean;

/**
 * How to come back after an unexpected disconnect. The session owns the retry loop; the caller
 * supplies how to open a socket and what to do once it is open (bind, for a client).
 */
export type ReconnectOptions = {
	connect: () => Promise<Result<{ sock: Socket }>>;
	maxDelay?: number | undefined;
	minDelay?: number | undefined;
	onConnected: (session: Session) => Promise<VoidResult>;
};

export type SessionOptions = {
	enquireLinkInterval?: number | undefined;
	idleTimeout?: number | undefined;
	log?: SmppLog | undefined;
	maxOctets?: number | undefined;
	maxOutstanding?: number | undefined;
	maxReassembly?: number | undefined;
	onRequest?: OnRequest | undefined;
	reassemblyTimeout?: number | undefined;
	reconnect?: ReconnectOptions | undefined;
	responseTimeout?: number | undefined;
	/** How long a drain waits for the requests already on the wire. 0 waits forever. */
	shutdownTimeout?: number | undefined;
	/** The notation the peer writes message ids in, where it is not the one they are compared in. */
	smsIdFormat?: SmsIdFormat | undefined;
	sock: Socket;
	/** This end's own identity, answered to the peer in place of the one it sent. */
	systemId?: string | undefined;
};

export const defaults = {
	bindType: 'transceiver',
	connectTimeout: 10_000,
	/** Receipts of a multipart message can be a working day apart, so the cap does the bounding. */
	dlrMergeTimeout: 86_400_000,
	enquireLinkInterval: 20_000,
	/** The peer gave up on an unanswered message long before this; the bound is against growth. */
	heldMessageTimeout: 300_000,
	host: 'localhost',
	/** The idle timeout is what notices a dead link, so it has to outlast one silent probe. */
	idleTimeoutFactor: 2,
	/** The version declared on the wire. */
	interfaceVersion: 0x34,
	maxDelay: 30_000,
	maxDlrMerges: 1000,
	maxHeldMessages: 1000,
	maxHeldOctets: 64 * 1024 * 1024,
	maxOctets: 64 * 1024 * 1024,
	maxOutstanding: 10,
	maxReassembly: 1000,
	minDelay: 1000,
	password: 'pass',
	port: 2775,
	reassemblyTimeout: 300_000,
	responseTimeout: 30_000,
	serverIdleTimeout: 40_000,
	shutdownTimeout: 5000,
	systemId: '',
	username: 'user',
} as const;

/**
 * A count below 1 does not fail loudly anywhere downstream: `maxOutstanding: 0` leaves every send
 * queued behind a slot that is never freed, so a send with no `signal` never settles at all.
 */
export function checkSessionOptions(options: CheckableOptions): VoidResult {
	if (options.fromStart !== undefined) {
		return { err: new Error('fromStart is part of the reconnect policy, spell it reconnect: { fromStart: true }') };
	}

	const connect = checkConnectTimeout(options.connectTimeout);

	if (connect.err) return connect;

	const checked = checkLimits(limitsOf(options));

	if (checked.err) return checked;

	const backoff = checkReconnect(options.reconnect);

	return backoff.err ? backoff : checkSmsIdFormat(options.smsIdFormat);
}

function limitsOf(options: CheckableOptions): [string, number, number][] {
	return [
		['idleTimeout', options.idleTimeout ?? 0, 0],
		['maxOctets', options.maxOctets ?? defaults.maxOctets, 1],
		['maxOutstanding', options.maxOutstanding ?? defaults.maxOutstanding, 1],
		['maxReassembly', options.maxReassembly ?? defaults.maxReassembly, 1],
		['reassemblyTimeout', options.reassemblyTimeout ?? defaults.reassemblyTimeout, 0],
		['responseTimeout', options.responseTimeout ?? defaults.responseTimeout, 0],
		['shutdownTimeout', options.shutdownTimeout ?? defaults.shutdownTimeout, 0],
	];
}

const maxTimerDelay = 2_147_483_647;

function checkConnectTimeout(connectTimeout: unknown): VoidResult {
	if (connectTimeout === undefined || connectTimeout === false) return {};

	const got = quoted(connectTimeout);

	if (typeof connectTimeout !== 'number' || !Number.isInteger(connectTimeout) || connectTimeout < 1) {
		return { err: new Error(`connectTimeout must be a whole number of milliseconds, 1 or more, got ${got}; false waits the OS out instead`) };
	}

	if (connectTimeout > maxTimerDelay) {
		return { err: new Error(`connectTimeout must be ${String(maxTimerDelay)} ms or less (about 24 days), got ${got}; false waits the OS out instead`) };
	}

	return {};
}

function checkLimits(limits: [string, number, number][]): VoidResult {
	for (const [name, value, min] of limits) {
		if (!Number.isInteger(value) || value < min) {
			return { err: new Error(`${name} must be ${String(min)} or more, got ${String(value)}`) };
		}
	}

	return {};
}

const reconnectKeys: readonly string[] = ['fromStart', 'maxDelay', 'minDelay'];

function checkReconnect(reconnect: unknown): VoidResult {
	if (reconnect === undefined || reconnect === false) return {};

	if (!isRecord(reconnect)) {
		return { err: new Error('reconnect takes { fromStart, maxDelay, minDelay }, or false to turn it off') };
	}

	for (const key of Object.keys(reconnect)) {
		if (!reconnectKeys.includes(key)) {
			return { err: new Error(`reconnect has no ${key}, name ${reconnectKeys.join(', ')}`) };
		}
	}

	if (reconnect.fromStart !== undefined && typeof reconnect.fromStart !== 'boolean') {
		return { err: new Error(`reconnect.fromStart must be true or false, got ${typeof reconnect.fromStart}`) };
	}

	const maxDelay = delayOr(reconnect.maxDelay, defaults.maxDelay);
	const minDelay = delayOr(reconnect.minDelay, defaults.minDelay);
	// A delay of 0 never doubles, so the backoff never starts and every retry lands at once.
	const checked = checkLimits([['maxDelay', maxDelay, 1], ['minDelay', minDelay, 1]]);

	if (checked.err) return checked;

	if (maxDelay < minDelay) {
		return { err: new Error(`maxDelay must be minDelay (${String(minDelay)}) or more, got ${String(maxDelay)}`) };
	}

	return {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A tuning value that is not a number lands on NaN, which the range check refuses by name. */
function delayOr(value: unknown, fallback: number): number {
	if (value === undefined) return fallback;

	return typeof value === 'number' ? value : NaN;
}

function checkSmsIdFormat(smsIdFormat: unknown): VoidResult {
	if (smsIdFormat === undefined) return {};

	if (!isRecord(smsIdFormat)) {
		return { err: new Error('smsIdFormat names a notation per place, as { receipt, submitResp }') };
	}

	for (const [place, notation] of Object.entries(smsIdFormat)) {
		if (!smsIdPlaces.includes(place)) {
			return { err: new Error(`smsIdFormat has no ${place}, name ${smsIdPlaces.join(' or ')}`) };
		}

		if (notation === undefined || isSmsIdNotation(notation)) continue;

		const got = namedValue(notation);

		return { err: new Error(`smsIdFormat.${place} must be ${smsIdNotations.join(' or ')}, got ${got}`) };
	}

	return {};
}

/** What the checker reads, as it arrives: a caller without types can put anything in it. */
export type CheckableOptions = {
	connectTimeout?: unknown;
	/** Not an option: the one spelling is inside reconnect, and this is where the other is refused. */
	fromStart?: unknown;
	idleTimeout?: number | undefined;
	maxOctets?: number | undefined;
	maxOutstanding?: number | undefined;
	maxReassembly?: number | undefined;
	reassemblyTimeout?: number | undefined;
	reconnect?: unknown;
	responseTimeout?: number | undefined;
	shutdownTimeout?: number | undefined;
	smsIdFormat?: unknown;
};
