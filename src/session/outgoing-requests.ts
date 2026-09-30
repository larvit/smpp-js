import type { LinkLife } from './link-life.ts';
import type { PduObject, PduObjectInput } from '../codec/pdu.ts';
import type { PduTransport } from './pdu-transport.ts';
import type { Result, VoidResult } from '../result.ts';
import type { SendOptions } from '../options.ts';
import type { SmppLog } from '../log.ts';
import { PendingRequests } from './pending-requests.ts';
import { SendWindow } from './send-window.ts';
import { UnansweredError } from '../unanswered-error.ts';
import { bindCommands } from '../protocol/bind.ts';
import { objToPdu } from '../codec/pdu.ts';

export type OutgoingRequestsOptions = {
	link: LinkLife;
	log: SmppLog;
	maxOutstanding: number;
	responseTimeout: number;
	transport: PduTransport;
};

/** `retryOnNextLink`: the write failed, so nothing reached the socket and another link may carry it. */
type Attempt = { result: Result<{ pduObj: PduObject }>; retryOnNextLink: boolean };

function abortedBeforeSend(): Error {
	return new Error('Aborted before the request was sent');
}

/** A response carries the request's sequence number, which only sendReturn() has. */
function misuse(input: PduObjectInput): Error | undefined {
	return input.cmdName.endsWith('_resp')
		? new Error(`Use sendReturn() for responses, not send(): ${input.cmdName}`)
		: undefined;
}

/** Everything this end asks of the peer: which link carries it, how many at once, and the answer. */
export class OutgoingRequests {
	private readonly link: LinkLife;
	private readonly log: SmppLog;
	private readonly pending: PendingRequests;
	private readonly responseTimeout: number;
	private readonly transport: PduTransport;
	private readonly window: SendWindow;

	constructor(options: OutgoingRequestsOptions) {
		this.link = options.link;
		this.log = options.log;
		this.pending = new PendingRequests(options.log);
		this.responseTimeout = options.responseTimeout;
		this.transport = options.transport;
		this.window = new SendWindow({ limit: options.maxOutstanding, log: options.log });
	}

	canCarry(): boolean {
		return this.link.isUp() && !this.transport.sock.destroyed;
	}

	/** The link is gone, and every answer still owed on it with it. */
	linkLost(): void {
		this.pending.settleAll(new Error('Session closed before a response arrived'));
	}

	/** Hands a response to the request waiting for it. False means nothing was. */
	deliver(pduObj: PduObject): boolean {
		return this.pending.deliver(pduObj);
	}

	/** A response the codec refused settles its request instead of leaving it to time out. */
	settleRefused(seqNr: number, err: Error): void {
		this.pending.settle(seqNr, { err });
	}

	request(input: PduObjectInput, options: SendOptions): Promise<Result<{ pduObj: PduObject }>> {
		// Ahead of the drain, so a misuse is named as one rather than blamed on the shutdown.
		const wrong = misuse(input);

		if (wrong) return Promise.resolve({ err: wrong });

		// With no link, the request is refused as closed further on.
		if (this.link.isStopped() && this.canCarry()) {
			return Promise.resolve({ err: new Error('Session is shutting down') });
		}

		return this.requestPastDrain(input, options);
	}

	/** request() without the drain's refusal, which a receipt for a held message has to take. */
	async requestPastDrain(
		input: PduObjectInput,
		options: SendOptions,
	): Promise<Result<{ pduObj: PduObject }>> {
		const refused = this.refuse(input, options);

		if (refused) return { err: refused };

		// A bind is what makes a link usable, so it cannot wait for one: it takes the link's answer now.
		if (bindCommands.includes(input.cmdName)) {
			const shut = this.link.refusal();

			return shut ? { err: shut } : this.requestOnCurrentLink(input, options);
		}

		const waitForLink = this.link.hold(options.signal);

		for (;;) {
			const held = await waitForLink();

			if (held.err) return { err: held.err };

			const slot = await this.window.acquire(options.signal);

			if (slot.err) return { err: slot.err };

			const attempt = await this.attempt(input, options).finally(() => { this.window.release(); });

			if (!this.retriesOnNextLink(attempt)) return attempt.result;
		}
	}

	/** Straight onto the current link, for what has to go out either way. */
	async requestOnCurrentLink(
		input: PduObjectInput,
		options: SendOptions = {},
	): Promise<Result<{ pduObj: PduObject }>> {
		return (await this.attempt(input, options)).result;
	}

	/** Waits out the requests already on the wire, and says how many never finished. */
	async drain(timeout: number, signal: AbortSignal | undefined): Promise<VoidResult> {
		const unfinished = await this.window.idle(timeout, signal);

		if (unfinished === 0) return {};

		this.log.warn('outgoingRequests - shutting down with requests unfinished', { timeout, unfinished });

		return { err: new Error(`Shut down with ${String(unfinished)} request(s) unfinished`) };
	}

	/** Nothing reached the socket, so the next link carries it. */
	private retriesOnNextLink(attempt: Attempt): boolean {
		// Until the link is dropped it admits the retry straight back onto the dead socket, and the loop spins.
		return attempt.retryOnNextLink && this.link.awaitsNextLink();
	}

	/** Why a request cannot go out at all, as opposed to not yet. */
	private refuse(input: PduObjectInput, options: SendOptions): Error | undefined {
		// Before the link and the window, or an aborted call waits for what it will never use.
		return misuse(input) ?? (options.signal?.aborted === true ? abortedBeforeSend() : undefined);
	}

	private async attempt(input: PduObjectInput, options: SendOptions): Promise<Attempt> {
		// pending.wait() alone settles the caller while the request still goes out to the peer.
		if (options.signal?.aborted === true) {
			return { result: { err: abortedBeforeSend() }, retryOnNextLink: false };
		}

		const seqNr = this.pending.nextSeqNr();
		const built = objToPdu({ ...input, seqNr });

		if (built.err) return { result: { err: built.err }, retryOnNextLink: false };

		const response = this.pending.wait(seqNr, {
			signal: options.signal,
			timeout: this.responseTimeout,
		});
		const written = this.transport.write(built.buffer);

		if (written.err) {
			this.pending.settle(seqNr, { err: written.err });

			return { result: { err: written.err }, retryOnNextLink: true };
		}

		const answered = await response;

		// It went out, so a failure now means the peer may have taken it and the answer was the loss.
		return { result: answered.err ? { err: new UnansweredError(answered.err) } : answered, retryOnNextLink: false };
	}
}
