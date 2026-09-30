import type { SmppLog } from '../log.ts';
import type { VoidResult } from '../result.ts';

export type LinkLifeOptions = {
	log: SmppLog;
	now?: (() => number) | undefined;
	/** Whether a dropped link is followed by another one until stop(). */
	reconnects: boolean;
	/** How long a request may wait for a link. 0 waits for as long as one may still arrive. */
	timeout: number;
};

/** `binding`: a socket is attached and its bind is not answered yet, so it carries nothing but that bind. */
type Phase = 'binding' | 'down' | 'ended' | 'up';

type Waiter = (result: VoidResult) => void;

function aborted(): Error {
	return new Error('Aborted while waiting for a link');
}

function expired(): Error {
	return new Error('The link did not come back in time');
}

function over(): Error {
	return new Error('Session is closed');
}

/** Whether the session's link lives, and where a request with no link to go out on waits for the next one. */
export class LinkLife {
	private readonly log: SmppLog;
	private readonly now: () => number;
	private readonly reconnects: boolean;
	private readonly timeout: number;
	private readonly waiting = new Set<Waiter>();
	private drops = 0;
	private phase: Phase = 'up';
	private stopped = false;

	constructor(options: LinkLifeOptions) {
		this.log = options.log;
		this.now = options.now ?? Date.now;
		this.reconnects = options.reconnects;
		this.timeout = options.timeout;
	}

	/** A socket is on the link, bound or not. */
	isAttached(): boolean {
		return this.phase === 'binding' || this.phase === 'up';
	}

	/** Whether a request can go out right now. */
	isUp(): boolean {
		return this.phase === 'up';
	}

	private isOver(): boolean {
		return this.phase === 'ended';
	}

	/** The session is shutting down: nothing new is taken, and no link follows this one. */
	isStopped(): boolean {
		return this.stopped;
	}

	/** Whether a link that drops now is followed by another. */
	retrying(): boolean {
		return this.reconnects && !this.stopped;
	}

	/** Not up and not over, with a link to come. */
	awaitsNextLink(): boolean {
		return !this.isUp() && !this.isOver() && this.retrying();
	}

	/** Changes with every drop, so what was read off one link can tell that link is gone. */
	generation(): number {
		return this.drops;
	}

	/** Why no request will ever be admitted, or undefined while one may still get through. */
	refusal(): Error | undefined {
		return this.isUp() || this.awaitsNextLink() ? undefined : over();
	}

	/** One budget for a request, however many links it waits through. */
	hold(signal: AbortSignal | undefined): () => Promise<VoidResult> {
		const deadline = this.timeout > 0 ? this.now() + this.timeout : 0;

		return () => this.wait(deadline, signal);
	}

	/** A socket from the reconnect loop, not yet bound. An ended session stays ended. */
	attach(): void {
		if (this.isOver()) return;

		this.phase = 'binding';
	}

	/** The link is bound: everything held goes out on it. */
	open(): void {
		this.phase = 'up';

		if (this.waiting.size > 0) {
			this.log.verbose('linkLife - sending what was held for a link', { held: this.waiting.size });
		}

		this.release({});
	}

	/** The attached link is gone: the event that says so, or undefined when there was none to lose. */
	drop(): 'close' | 'disconnected' | undefined {
		if (!this.isAttached()) return undefined;

		this.phase = 'down';
		this.drops++;

		return this.retrying() ? 'disconnected' : 'close';
	}

	stop(): void {
		this.stopped = true;
	}

	/** The session is over: nothing held will ever go out. False means it already was. */
	end(): boolean {
		if (this.isOver()) return false;

		this.phase = 'ended';
		this.stopped = true;
		this.release({ err: over() });

		return true;
	}

	/** Resolves once a link can carry the request, or with the reason none ever will. */
	private wait(deadline: number, signal: AbortSignal | undefined): Promise<VoidResult> {
		if (this.isUp()) return Promise.resolve({});

		const refused = this.refusal();

		if (refused) return Promise.resolve({ err: refused });

		if (signal?.aborted === true) return Promise.resolve({ err: aborted() });

		const left = deadline === 0 ? 0 : deadline - this.now();

		if (deadline !== 0 && left <= 0) return Promise.resolve({ err: expired() });

		return this.waitForLink(left, signal);
	}

	private waitForLink(left: number, signal: AbortSignal | undefined): Promise<VoidResult> {
		this.log.verbose('linkLife - holding a request until a link is back', { timeout: left });

		return new Promise<VoidResult>(resolve => {
			let timer: NodeJS.Timeout | undefined = undefined;
			const settle = (result: VoidResult): void => {
				if (timer) clearTimeout(timer);

				signal?.removeEventListener('abort', onAbort);
				this.waiting.delete(settle);
				resolve(result);
			};
			const giveUp = (): void => {
				this.log.warn('linkLife - no link came back in time', { timeout: left });
				settle({ err: expired() });
			};

			function onAbort(): void {
				settle({ err: aborted() });
			}

			// Not unref()'d: a held request is awaited with no other handle, so the process would exit unsettled.
			if (left > 0) timer = setTimeout(giveUp, left);

			signal?.addEventListener('abort', onAbort, { once: true });
			this.waiting.add(settle);
		});
	}

	private release(result: VoidResult): void {
		for (const settle of [...this.waiting]) {
			settle(result);
		}
	}
}
