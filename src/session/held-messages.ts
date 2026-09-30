import type { LinkLife } from './link-life.ts';
import type { PduObject, PduObjectInput } from '../codec/pdu.ts';
import type { Result } from '../result.ts';
import type { Session } from './session.ts';
import type { SmsHandlers } from './sms.ts';
import type { SmppLog } from '../log.ts';
import { ExpiringGroups } from '../messages/expiring-groups.ts';
import { IdleWaiters } from './idle-waiters.ts';
import { createSms } from './sms.ts';
import { retainedOctets } from '../codec/retained-pdu.ts';

export type HeldMessagesOptions = {
	link: LinkLife;
	log: SmppLog;
	max: number;
	maxOctets: number;
	/** Injected so expiry can be exercised without a wall clock. */
	now?: (() => number) | undefined;
	sendPastDrain: SmsHandlers['send'];
	session: Session;
	timeout: number;
};

/** The peer's own sequence number, which is what our answer to this message will carry. */
function keyOf(pduObjs: PduObject[]): string | undefined {
	const first = pduObjs[0];

	return first ? String(first.seqNr) : undefined;
}

type HoldRoute = Pick<HeldMessagesOptions, 'link' | 'sendPastDrain' | 'session'>;

/**
 * One message offered to the application, and the handlers its `Sms` answers through. A drain
 * waits on it until the first of: `answered()`, every listener that took it rejecting, no listener
 * taking it or one throwing, a later message on its sequence number, its deadline, or the link going.
 */
export class MessageHold implements SmsHandlers {
	private readonly generation: number;
	private readonly heldMessages: HeldMessages;
	private readonly pduObjs: PduObject[];
	private readonly route: HoldRoute;
	private working: number;

	constructor(heldMessages: HeldMessages, route: HoldRoute, pduObjs: PduObject[], listeners: number) {
		this.generation = route.link.generation();
		this.heldMessages = heldMessages;
		this.pduObjs = pduObjs;
		this.route = route;
		this.working = listeners;
	}

	/** Whether a drain is still waiting for this message to be answered. */
	isHeld(): boolean {
		return this.heldMessages.holds(this.pduObjs);
	}

	/** A turn later, so a `sendDlr()` called straight after `sendResp()` still goes out past a drain. */
	answered(): void {
		setImmediate(() => { this.release(); });
	}

	lostLink(): boolean {
		return this.route.link.generation() !== this.generation;
	}

	/** A rejection leaves the other listeners running, so only the last one to fail gives the message up. */
	listenerGaveUp(): void {
		this.working--;

		if (this.working <= 0) this.answered();
	}

	/** At once, for a message nobody took or a listener threw on: that is not work a shutdown can wait for. */
	release(): void {
		this.heldMessages.release(this.pduObjs);
	}

	/** A receipt for a message still held is what a drain waits for, so it goes out past the drain. */
	send(input: PduObjectInput): Promise<Result<{ pduObj: PduObject }>> {
		return this.isHeld() ? this.route.sendPastDrain(input) : this.route.session.send(input);
	}
}

/** The messages handed to the application that it has not answered yet, held by their segments. */
export class HeldMessages {
	private readonly held: ExpiringGroups<PduObject[]>;
	private readonly idleWaiters = new IdleWaiters();
	private readonly log: SmppLog;
	private readonly maxOctets: number;
	/** A rejecting listener hands the message back as an `unknown`, so its hold is found by identity. */
	private readonly offered = new WeakMap<object, MessageHold>();
	private readonly route: HoldRoute;

	constructor(options: HeldMessagesOptions) {
		this.held = new ExpiringGroups({
			max: options.max,
			now: options.now,
			onSweep: () => { this.sweep(); },
			timeout: options.timeout,
		});
		this.log = options.log;
		this.maxOctets = options.maxOctets;
		this.route = { link: options.link, sendPastDrain: options.sendPastDrain, session: options.session };
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

	private hold(key: string, pduObjs: PduObject[], listeners: number): MessageHold {
		const hold = new MessageHold(this, this.route, pduObjs, listeners);

		this.sweep();

		if (this.held.get(key)) {
			this.log.warn('heldMessages - replacing a message on a re-used sequence number', { seqNr: Number(key) });
		}

		this.held.set(key, pduObjs);
		this.held.weigh(key, pduObjs.reduce((sum, pduObj) => sum + retainedOctets(pduObj), 0));

		return hold;
	}

	offer(pduObjs: PduObject[], answeredAs?: string): MessageHold | undefined {
		const key = keyOf(pduObjs);

		if (key === undefined) return undefined;

		const hold = this.hold(key, pduObjs, this.route.session.listenerCount('sms'));
		const sms = createSms({ answeredAs, pduObjs, session: this.route.session }, hold);

		this.offered.set(sms, hold);

		if (!this.route.session.emit('sms', sms)) hold.release();

		return hold;
	}

	/** One listener gave up on a message; the last one to do so is what releases it. */
	listenerRejected(message: unknown): void {
		if (typeof message !== 'object' || message === null) return;

		this.offered.get(message)?.listenerGaveUp();
	}

	holds(pduObjs: PduObject[]): boolean {
		const key = keyOf(pduObjs);

		return key !== undefined && this.held.get(key) === pduObjs;
	}

	release(pduObjs: PduObject[]): void {
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
