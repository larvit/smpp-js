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

type Held = {
	octets: number;
	pduObjs: PduObject[];
};

/** The messages handed to the application that it has not answered yet, held by their segments. */
export class HeldMessages {
	private readonly held: ExpiringGroups<Held>;
	private readonly idleWaiters = new IdleWaiters();
	private readonly log: SmppLog;
	private readonly maxOctets: number;
	private octets = 0;

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
		return this.octets;
	}

	get size(): number {
		return this.held.size;
	}

	/** Whether a message arriving now is past the bound, once the expired are swept. */
	full(): boolean {
		this.sweep();

		return this.held.full || this.octets >= this.maxOctets;
	}

	hold(pduObjs: PduObject[]): void {
		const key = keyOf(pduObjs);

		if (key === undefined) return;

		this.sweep();

		const replaced = this.held.get(key);

		if (replaced) {
			this.log.warn('heldMessages - replacing a message on a re-used sequence number', { seqNr: Number(key) });
			this.delete(key, replaced);
		}

		const octets = pduObjs.reduce((sum, pduObj) => sum + retainedOctets(pduObj), 0);

		this.held.set(key, { octets, pduObjs });
		this.octets += octets;
	}

	/** Whether a drain is still waiting for this message to be answered. */
	has(pduObjs: PduObject[]): boolean {
		const key = keyOf(pduObjs);

		return key !== undefined && this.held.get(key)?.pduObjs === pduObjs;
	}

	release(pduObjs: PduObject[]): void {
		const key = keyOf(pduObjs);

		// Identity, not the key: a wrapped sequence number must not release someone else's message.
		const held = key === undefined ? undefined : this.held.get(key);

		if (key === undefined || held?.pduObjs !== pduObjs) return;

		this.delete(key, held);
		this.settle();
	}

	/** Drops every message: their segments went with the link, so no answer of ours correlates now. */
	clear(): void {
		this.held.takeAll();
		this.octets = 0;
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

		for (const [, held] of expired) {
			this.octets -= held.octets;
		}

		this.log.warn('heldMessages - messages the application never answered', {
			messages: expired.length,
		});
		this.settle();
	}

	private delete(key: string, held: Held): void {
		this.held.delete(key);
		this.octets -= held.octets;
	}

	private settle(): void {
		if (this.held.size === 0) this.idleWaiters.settle();
	}
}
