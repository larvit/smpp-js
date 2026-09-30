import type { Dlr } from '../protocol/dlr.ts';
import type { ErrorName } from '../codec/errors.ts';
import type { MessageDlr } from '../messages/dlr-merger.ts';
import type { ParamValue } from '../codec/types.ts';
import type { PduObject, PduObjectInput, TlvInputs } from '../codec/pdu.ts';
import type { PduRefusedError } from '../codec/refusal.ts';
import type { BindType, LinkEnd, SessionBind } from '../protocol/bind.ts';
import type { CloseOptions, ReconnectOptions, SendOptions, SessionOptions } from '../options.ts';
import type { Result, VoidResult } from '../result.ts';
import type { SendSmsOptions, SendSmsResult } from '../messages/submit.ts';
import type { SmppLog } from '../log.ts';
import type { Sms } from './sms.ts';
import type { Socket } from 'node:net';
import { DlrMerger } from '../messages/dlr-merger.ts';
import { EventEmitter } from 'node:events';
import { IncomingRequests } from './incoming-requests.ts';
import { LinkLife } from './link-life.ts';
import { LinkTimers } from './link-timers.ts';
import { OutgoingRequests } from './outgoing-requests.ts';
import { PduTransport } from './pdu-transport.ts';
import { ReconnectLoop } from './reconnect-loop.ts';
import { leftOf } from './idle-waiters.ts';
import { errorFrom } from '../result.ts';
import { optionalParamsMinVersion } from '../codec/constants.ts';
import { bindCarries, checkedBind } from '../protocol/bind.ts';
import { defaults } from '../options.ts';
import { isResp, objToPdu, pduReturn } from '../codec/pdu.ts';
import { refusalAnswer } from '../codec/refusal.ts';
import { guardedLog } from '../log.ts';
import { submitSms, unsent } from '../messages/submit.ts';
import { ConcatReference } from '../protocol/udh.ts';

export type {
	CloseOptions,
	MessageDlr,
	ReconnectOptions,
	SendOptions,
	SendSmsOptions,
	SendSmsResult,
	SessionOptions,
};
export type { BindType };

export type SessionEvents = {
	close: [];
	data: [Buffer];
	disconnected: [];
	dlr: [Dlr, PduObject];
	incomingPdu: [Buffer];
	incomingPduObj: [PduObject];
	messageDlr: [MessageDlr];
	reconnected: [];
	sessionError: [Error | PduRefusedError];
	sms: [Sms];
};

/** A listener may return a promise: an `async` one that rejects is routed like one that throws. */
type SessionListener<K extends keyof SessionEvents> = (...args: SessionEvents[K]) => unknown;

export class Session extends EventEmitter<SessionEvents> {
	declare addListener: <K extends keyof SessionEvents>(event: K, listener: SessionListener<K>) => this;
	declare off: <K extends keyof SessionEvents>(event: K, listener: SessionListener<K>) => this;
	declare on: <K extends keyof SessionEvents>(event: K, listener: SessionListener<K>) => this;
	declare once: <K extends keyof SessionEvents>(event: K, listener: SessionListener<K>) => this;
	declare prependListener: <K extends keyof SessionEvents>(event: K, listener: SessionListener<K>) => this;
	declare prependOnceListener: <K extends keyof SessionEvents>(event: K, listener: SessionListener<K>) => this;
	declare removeListener: <K extends keyof SessionEvents>(event: K, listener: SessionListener<K>) => this;

	readonly log: SmppLog;

	/** Which end of the link this is. `server()` sets it; a hand-wired SMSC must set it too. */
	linkEnd: LinkEnd = 'esme';
	userData: unknown = undefined;

	private bind: SessionBind | undefined = undefined;

	private readonly concatReference = new ConcatReference();
	private readonly dlrMerger: DlrMerger;
	private readonly incoming: IncomingRequests;
	private readonly link: LinkLife;
	private readonly options: SessionOptions;
	private readonly outgoing: OutgoingRequests;
	private readonly reconnectLoop: ReconnectLoop | undefined;
	private readonly timers: LinkTimers;
	private readonly transport: PduTransport;

	/** A listener that throws is the application's bug; it must not become ours. Hard rule 1. */
	override emit<K extends keyof SessionEvents>(
		event: K,
		...args: K extends keyof SessionEvents ? SessionEvents[K] : never
	): boolean {
		try {
			return super.emit(event, ...args);
		} catch (thrown: unknown) {
			const err = errorFrom(thrown);

			this.log.error('session - a listener threw', { event, message: err.message });

			// Guarded against the listener that throws being the one listening for this.
			if (event !== 'sessionError') this.emit('sessionError', err);

			return false;
		}
	}

	/** The same guard for a listener that rejects rather than throws; captureRejections routes here. */
	override [EventEmitter.captureRejectionSymbol](
		reason: unknown,
		...args: [event: keyof SessionEvents, ...rest: unknown[]]
	): void {
		const [event, ...rest] = args;
		const error = errorFrom(reason);

		this.log.error('session - a listener rejected', { event, message: error.message });

		if (event === 'sms') this.incoming.listenerRejected(rest[0]);

		if (event !== 'sessionError') this.emit('sessionError', error);
	}

	constructor(options: SessionOptions) {
		super({ captureRejections: true });

		this.log = guardedLog(options.log);
		this.options = options;
		this.dlrMerger = new DlrMerger({ log: this.log, max: defaults.maxDlrMerges, timeout: defaults.dlrMergeTimeout });
		this.reconnectLoop = this.loopFor(options.reconnect);

		const responseTimeout = options.responseTimeout ?? defaults.responseTimeout;

		this.link = new LinkLife({ log: this.log, reconnects: this.reconnectLoop !== undefined, timeout: responseTimeout });
		this.timers = new LinkTimers({
			enquireLinkInterval: options.enquireLinkInterval,
			idleTimeout: options.idleTimeout,
			log: this.log,
			onEnquireLink: () => { void this.send({ cmdName: 'enquire_link' }); },
			// Not close(): a link that went quiet is a drop, and a drop is what reconnect is for.
			onIdle: () => { this.teardown(); },
		});
		this.transport = this.transportFor(options.sock);
		this.outgoing = new OutgoingRequests({
			link: this.link,
			log: this.log,
			maxOutstanding: options.maxOutstanding ?? defaults.maxOutstanding,
			responseTimeout,
			transport: this.transport,
		});
		this.incoming = new IncomingRequests({
			dlrMerger: this.dlrMerger,
			link: this.link,
			log: this.log,
			maxOctets: options.maxOctets,
			maxReassembly: options.maxReassembly,
			onRequest: options.onRequest,
			reassemblyTimeout: options.reassemblyTimeout,
			sendPastDrain: input => this.outgoing.requestPastDrain(input, {}),
			session: this,
			smsIdFormat: options.smsIdFormat,
			systemId: options.systemId,
		});

		this.resetTimers();
	}

	/** Replaced on reconnect, so hold the session rather than this. */
	get sock(): Socket {
		return this.transport.sock;
	}

	/** The role the ESME bound with, whichever end of the link this is. Undefined before any bind. */
	get boundAs(): BindType | undefined {
		return this.bind?.as;
	}

	/** What the peer declared when binding: 0x00 if it declared none, undefined before any bind. */
	get peerInterfaceVersion(): number | undefined {
		return this.bind?.peerVersion;
	}

	/** Records a bind this link accepted or had accepted, until the next one. */
	bound(bindType: string, declaredVersion: unknown): VoidResult {
		const checked = checkedBind(bindType, declaredVersion);

		if (!checked.err) this.bind = checked.bind;

		return checked.err ? { err: checked.err } : {};
	}

	/** Whether this session's bind direction carries a command. Consulted by the library's senders. */
	bindAllows(cmdName: string): boolean {
		return bindCarries(this.boundAs, cmdName, this.linkEnd);
	}

	/** SMPP 3.4 forbids sending optional parameters to a peer that declared an older version. */
	acceptsOptionalParams(): boolean {
		return this.peerInterfaceVersion === undefined || this.peerInterfaceVersion >= optionalParamsMinVersion;
	}

	/** Sends a request and resolves with the peer's response. */
	send(input: PduObjectInput, options: SendOptions = {}): Promise<Result<{ pduObj: PduObject }>> {
		return this.outgoing.request(input, options);
	}

	/** Answers a request the peer sent us. Responses are never waited on. */
	sendReturn(
		pdu: PduObject,
		status: ErrorName = 'ESME_ROK',
		params: Record<string, ParamValue> = {},
		tlvs?: TlvInputs,
	): Promise<VoidResult> {
		return Promise.resolve(this.answer(pduReturn(pdu, status, params, tlvs), pdu.cmdName, pdu.seqNr));
	}

	private answer(built: Result<{ buffer: Buffer }>, cmdName: string, seqNr: number): VoidResult {
		const sent = built.err ? { err: built.err } : this.transport.write(built.buffer);

		// A peer that unbinds and drops the link takes our response with it; that is not a failure.
		if (sent.err && this.link.isAttached()) {
			this.log.warn('session - could not answer a request', {
				cmdName,
				message: sent.err.message,
				seqNr,
			});
			this.emit('sessionError', sent.err);
		}

		return sent;
	}

	async sendSms(sms: SendSmsOptions, options: SendOptions = {}): Promise<SendSmsResult> {
		if (!this.bindAllows('submit_sm')) {
			return unsent(new Error('A receiver-bound session does not carry submit_sm'));
		}

		const sent = await submitSms({
			log: this.log,
			reference: this.concatReference.next(),
			respIdNotation: this.options.smsIdFormat?.submitResp,
			send: input => this.send(input, options),
		}, sms);

		if (!sent.err && sms.dlr === true) this.dlrMerger.expect(sent.smsIds);

		return sent;
	}

	/**
	 * Drains, unbinds politely, then closes. Many SMSCs drop the link instead of answering the
	 * unbind, which is fine. Reports the unbind's own failure ahead of an unfinished drain.
	 */
	async unbind(): Promise<VoidResult> {
		const drained = await this.drain(undefined);
		const wasOpen = this.link.isAttached();
		const sent = wasOpen
			? await this.outgoing.requestOnCurrentLink({ cmdName: 'unbind' })
			: { err: new Error('Session is closed') };
		const closedOnUnbind = wasOpen && !this.link.isAttached();

		this.end();

		return sent.err && !closedOnUnbind ? { err: sent.err } : drained;
	}

	/**
	 * Closes for good: refuses new sends, waits up to `shutdownTimeout` for the requests already sent
	 * and the messages not yet answered, then tears down whatever is left. A session closed this way never reconnects.
	 */
	async close(options: CloseOptions = {}): Promise<VoidResult> {
		const drained = await this.drain(options.signal);

		this.end();

		return drained;
	}

	private transportFor(sock: Socket): PduTransport {
		return new PduTransport({
			log: this.log,
			onClose: () => { this.onClose(); },
			onData: chunk => { this.onData(chunk); },
			onError: err => { this.emit('sessionError', err); },
			onFramed: pdu => { this.emit('incomingPdu', pdu); },
			onPdu: pduObj => { this.dispatch(pduObj); },
			onRefused: refused => { this.refuse(refused); },
			onUnreadable: err => {
				this.emit('sessionError', err);
				this.teardown();
			},
		}, sock);
	}

	private loopFor(reconnect: ReconnectOptions | undefined): ReconnectLoop | undefined {
		if (!reconnect) return undefined;

		return new ReconnectLoop({
			connect: reconnect.connect,
			log: this.log,
			maxDelay: reconnect.maxDelay,
			minDelay: reconnect.minDelay,
			onConnected: sock => this.comeBackUp(sock, reconnect.onConnected),
		});
	}

	private async comeBackUp(
		sock: Socket,
		bind: (session: Session) => Promise<VoidResult>,
	): Promise<VoidResult> {
		this.attach(sock);

		const bound = await bind(this);

		if (bound.err) {
			this.teardown();

			return { err: bound.err };
		}

		// close() can land while the rebind is in flight.
		if (!this.link.retrying()) {
			this.teardown();

			return { err: new Error('Session closed while it was coming back up') };
		}

		this.resetTimers();
		this.link.open();
		this.log.info('session - reconnected');
		this.emit('reconnected');

		return {};
	}

	private attach(sock: Socket): void {
		this.transport.attach(sock);
		this.link.attach();
	}

	/** Stops new sends and waits out the messages we hold and the requests already issued. */
	private async drain(signal: AbortSignal | undefined): Promise<VoidResult> {
		this.stop();

		// No bound link, so nothing is on the wire to wait out.
		if (!this.outgoing.canCarry()) return {};

		const timeout = this.options.shutdownTimeout ?? defaults.shutdownTimeout;
		const deadline = timeout > 0 ? Date.now() + timeout : 0;
		// Answering a message can put a receipt on the wire; nothing on the wire produces a message.
		const messages = await this.incoming.drain(this.answering(timeout), signal);
		const requests = await this.outgoing.drain(leftOf(deadline), signal);

		// The link went before the drain finished, so an empty window says nothing about the peer.
		if (!this.outgoing.canCarry()) {
			return { err: new Error('The session closed before the drain finished') };
		}

		if (!messages.err) return requests;

		if (!requests.err) return messages;

		return { err: new Error(`${messages.err.message}; ${requests.err.message}`) };
	}

	/** The application half's budget, which may never be "forever": nothing else ends that wait. */
	private answering(timeout: number): number {
		if (timeout > 0) return timeout;

		const responseTimeout = this.options.responseTimeout ?? defaults.responseTimeout;

		return responseTimeout > 0 ? responseTimeout : defaults.responseTimeout;
	}

	/** The session is over now, drained or not. Nothing brings it back. */
	private end(): void {
		this.stop();
		this.teardown();
		this.dlrMerger.clear();
		this.emitClose();
	}

	/** No new sends, and no link after this one. */
	private stop(): void {
		this.link.stop();
		this.reconnectLoop?.stop();
	}

	private emitClose(): void {
		if (!this.link.end()) return;

		this.outgoing.linkLost();
		this.emit('close');
	}

	private teardown(): void {
		const lost = this.link.drop();

		if (!lost) return;

		this.outgoing.linkLost();
		this.timers.clear();
		this.incoming.clear();
		this.sock.destroy();

		// `lost` is read before clear(): a listener it reaches may close() the session, and the drop still reports as disconnected.
		if (lost === 'disconnected') this.emit('disconnected');
		else this.emitClose();
	}

	private onData(chunk: Buffer): void {
		this.emit('data', chunk);
		this.resetTimers();
	}

	private dispatch(pduObj: PduObject): void {
		if (isResp(pduObj)) {
			if (!this.outgoing.deliver(pduObj)) {
				this.log.debug('session - response with no matching request', { seqNr: pduObj.seqNr });
			}

			return;
		}

		this.emit('incomingPduObj', pduObj);
		// Every application hook and listener reached from an incoming PDU funnels through here.
		void this.incoming.handle(pduObj).catch((thrown: unknown) => {
			const err = errorFrom(thrown);

			this.log.error('session - a handler threw', {
				cmdName: pduObj.cmdName,
				message: err.message,
				seqNr: pduObj.seqNr,
			});
			this.emit('sessionError', err);
		});
	}

	/** A PDU the codec refused. Its header parsed, so the peer gets an answer and the link stays. */
	private refuse(refused: PduRefusedError): void {
		const { cmdId, cmdName, seqNr } = refused.header;

		this.emit('sessionError', refused);

		// A response carries a sequence number of ours, so writing one back lands in the peer's space.
		if (isResp(refused.header)) {
			this.outgoing.settleRefused(seqNr, refused);

			return;
		}

		this.answer(objToPdu({ ...refusalAnswer(refused), seqNr }), cmdName ?? String(cmdId), seqNr);
	}

	private resetTimers(): void {
		if (!this.link.isAttached()) return;

		this.timers.reset();
	}

	private onClose(): void {
		if (this.link.retrying()) {
			this.teardown();
			this.reconnectLoop?.schedule();

			return;
		}

		this.end();
	}
}
