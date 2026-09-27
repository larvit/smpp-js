import type { PduObject } from './pdu.ts';
import type { SmppLog } from './log.ts';
import { ExpiringGroups } from './expiring-groups.ts';
import { IdleWaiters } from './idle-waiters.ts';
import { retainedOctets } from './retained-pdu.ts';

export type HeldMessagesOptions = {
	log: SmppLog;
	max: number;
	maxOctets: number;
	/** Injected so expiry can be exercised without a wall clock. */
	now?: (() => number) | undefined;
	timeout: number;
};

/** The peer's own sequence number, which is what our answer to this message will carry. */
function keyOf(pduObjs: PduObject[]): string | undefined {
	const first = pduObjs[0];

	return first ? String(first.seqNr) : undefined;
}

type HoldEntry = {
	isHeld: () => boolean;
	release: () => void;
};

/** One message offered to the application, held until it is answered or every listener gives up. */
export class MessageHold {
	private readonly entry: HoldEntry;
	private working: number;

	constructor(entry: HoldEntry, listeners: number) {
		this.entry = entry;
		this.working = listeners;
	}

	/** Whether a drain is still waiting for this message to be answered. */
	isHeld(): boolean {
		return this.entry.isHeld();
	}

	/** A turn later, so a listener sending its receipt straight after the response still holds. */
	answered(): void {
		setImmediate(() => { this.entry.release(); });
	}

	/** A rejection leaves the other listeners running, so only the last one to fail gives the message up. */
	listenerGaveUp(): void {
		this.working--;

		if (this.working <= 0) this.answered();
	}

	/** At once, for a message nobody took: that is not work a shutdown can wait for. */
	release(): void {
		this.entry.release();
	}
}

/** The messages handed to the application that it has not answered yet, held by their segments. */
export class HeldMessages {
	private readonly held: ExpiringGroups<PduObject[]>;
	private readonly idleWaiters = new IdleWaiters();
	private readonly log: SmppLog;
	private readonly maxOctets: number;

	constructor(options: HeldMessagesOptions) {
		this.held = new ExpiringGroups({
			max: options.max,
			now: options.now,
			onSweep: () => { this.sweep(); },
			timeout: options.timeout,
		});
		this.log = options.log;
		this.maxOctets = options.maxOctets;
	}

	get octetsHeld(): number {
		return this.held.weight;
	}

	get size(): number {
		return this.held.size;
	}

	/** Whether a message arriving now is past the bound, once the expired are swept. */
	full(): boolean {
		this.sweep();

		return this.held.full || this.held.weight >= this.maxOctets;
	}

	hold(pduObjs: PduObject[], listeners: number): MessageHold {
		const hold = new MessageHold({
			isHeld: () => this.has(pduObjs),
			release: () => { this.release(pduObjs); },
		}, listeners);
		const key = keyOf(pduObjs);

		if (key === undefined) return hold;

		this.sweep();

		if (this.held.get(key)) {
			this.log.warn('heldMessages - replacing a message on a re-used sequence number', { seqNr: Number(key) });
		}

		this.held.set(key, pduObjs, pduObjs.reduce((sum, pduObj) => sum + retainedOctets(pduObj), 0));

		return hold;
	}

	private has(pduObjs: PduObject[]): boolean {
		const key = keyOf(pduObjs);

		return key !== undefined && this.held.get(key) === pduObjs;
	}

	private release(pduObjs: PduObject[]): void {
		const key = keyOf(pduObjs);

		// Identity, not the key: a wrapped sequence number must not release someone else's message.
		if (key === undefined || this.held.get(key) !== pduObjs) return;

		this.held.delete(key);
		this.settle();
	}

	/** Drops every message: their segments went with the link, so no answer of ours correlates now. */
	clear(): void {
		this.held.takeAll();
		this.idleWaiters.settle();
	}

	/** Resolves 0 once every message has been answered, or with how many have not. */
	idle(timeout: number, signal: AbortSignal | undefined): Promise<number> {
		return this.idleWaiters.wait(() => this.held.size, timeout, signal);
	}

	/** Drops every message past its deadline. Runs before each hold and on its own timer. */
	sweep(): void {
		const expired = this.held.takeExpired();

		if (expired.length === 0) return;

		this.log.warn('heldMessages - messages the application never answered', {
			messages: expired.length,
		});
		this.settle();
	}

	private settle(): void {
		if (this.held.size === 0) this.idleWaiters.settle();
	}
}
