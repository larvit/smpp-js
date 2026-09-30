import type { Concat } from '../protocol/concat.ts';
import type { DlrMerger } from '../messages/receipt-merge.ts';
import type { ErrorName } from '../codec/statuses.ts';
import type { HeldMessagesOptions } from './held-messages.ts';
import type { LinkLife } from '../link-life.ts';
import type { LostGroup, Refusal } from '../messages/reassembly.ts';
import type { OnRequest } from '../options.ts';
import type { PduObject } from '../codec/pdu.ts';
import type { VoidResult } from '../result.ts';
import type { Session } from '../session.ts';
import type { SmppLog } from '../log.ts';
import type { SmsIdFormat } from '../protocol/message-ids.ts';
import { HeldMessages } from './held-messages.ts';
import { Reassembler } from '../messages/reassembly.ts';
import { bindCommands, standsInFor } from '../protocol/bind.ts';
import { defaults } from '../options.ts';
import { concatOf } from '../protocol/concat.ts';
import { detach } from '../codec/retained.ts';
import { dlrFromPdu } from '../protocol/receipt.ts';
import { respIdParams, segmentId } from '../protocol/message-ids.ts';
import { respNameFor } from '../codec/commands.ts';

/** Asks the peer to keep the message and retry. */
function throttledStatus(carriedAs: string): ErrorName {
	return carriedAs === 'submit_sm' ? 'ESME_RTHROTTLED' : 'ESME_RX_T_APPN';
}

export function refusedSegmentStatus(
	carriedAs: string,
	refusal: Refusal,
	spelling: Concat['spelling'],
): ErrorName {
	// A sar_* segment's esm_class is 0x00 and correct: naming it would name the part the peer got right.
	if (refusal === 'unplaceable') {
		return spelling === 'sar' ? 'ESME_RINVTLVVAL' : 'ESME_RINVESMCLASS';
	}

	return throttledStatus(carriedAs);
}

const lostReasons: Record<LostGroup['reason'], string> = {
	evicted: 'the reassembly buffer filled',
	expired: 'no further segment arrived in time',
	linkGone: 'the link they arrived on went',
};

export type IncomingRequestsOptions = {
	dlrMerger: DlrMerger;
	link: LinkLife;
	log: SmppLog;
	maxOctets?: number | undefined;
	maxReassembly?: number | undefined;
	onRequest?: OnRequest | undefined;
	reassemblyTimeout?: number | undefined;
	sendPastDrain: HeldMessagesOptions['sendPastDrain'];
	session: Session;
	smsIdFormat?: SmsIdFormat | undefined;
	systemId?: string | undefined;
};

/** Everything the peer asks of a session: messages, receipts, links and the answers to them. */
export class IncomingRequests {
	private readonly dlrMerger: DlrMerger;
	private readonly held: HeldMessages;
	private readonly link: LinkLife;
	private readonly log: SmppLog;
	private readonly onRequest: OnRequest | undefined;
	private readonly reassembler: Reassembler;
	private readonly session: Session;
	private readonly smsIdFormat: SmsIdFormat;
	private readonly systemId: string;
	private refusing = false;

	constructor(options: IncomingRequestsOptions) {
		this.dlrMerger = options.dlrMerger;
		this.held = new HeldMessages({
			link: options.link,
			log: options.log,
			max: defaults.maxHeldMessages,
			maxOctets: defaults.maxHeldOctets,
			sendPastDrain: options.sendPastDrain,
			session: options.session,
			timeout: defaults.heldMessageTimeout,
		});
		this.link = options.link;
		this.log = options.log;
		this.onRequest = options.onRequest;
		this.reassembler = new Reassembler({
			log: options.log,
			max: options.maxReassembly ?? defaults.maxReassembly,
			maxOctets: options.maxOctets,
			onLost: lost => { this.reportLost(lost); },
			timeout: options.reassemblyTimeout ?? defaults.reassemblyTimeout,
		});
		this.session = options.session;
		this.smsIdFormat = options.smsIdFormat ?? {};
		this.systemId = options.systemId ?? defaults.systemId;
	}

	async handle(pduObj: PduObject): Promise<void> {
		const generation = this.link.generation();
		const { onRequest } = this;

		// Called unbound, so the application's hook never sees this class as its `this`.
		if (onRequest && await onRequest(this.session, pduObj)) return;

		// The link it arrived on went while the hook ran, so nothing we answer now correlates.
		if (this.link.generation() !== generation) {
			this.log.info('session - dropping a request whose link went', { cmdName: pduObj.cmdName });

			return;
		}

		if (!this.session.bindAllows(pduObj.cmdName)) {
			this.log.info('session - command the peer\'s bind direction does not carry', {
				bindType: this.session.boundAs ?? '',
				cmdName: pduObj.cmdName,
			});
			await this.session.sendReturn(pduObj, 'ESME_RINVBNDSTS');

			return;
		}

		await this.route(pduObj);
	}

	private async route(pduObj: PduObject): Promise<void> {
		switch (pduObj.cmdName) {
			case 'data_sm':
			case 'deliver_sm':
				// A data_sm at the SMSC end is a submission, and a submission is never a report.
				await (this.carriedAs(pduObj) === 'submit_sm'
					? this.onMessage(pduObj)
					: this.onDelivery(pduObj));
				break;
			case 'enquire_link':
				await this.session.sendReturn(pduObj);
				break;
			case 'submit_sm':
				await this.onMessage(pduObj);
				break;
			case 'unbind':
				await this.session.sendReturn(pduObj);
				// A peer that has said it is finished will not answer what we still have outstanding.
				await this.session.close({ signal: AbortSignal.abort() });
				break;
			default:
				await this.unhandled(pduObj);
		}
	}

	/** Drops the segments of every message that never became whole, and of every one still held. */
	clear(): void {
		this.refusing = false;
		this.held.clear();
		this.reassembler.clear();
	}

	listenerRejected(sms: unknown): void {
		this.held.listenerRejected(sms);
	}

	/** Waits out the messages the application still holds, and says how many it never answered. */
	async drain(timeout: number, signal: AbortSignal | undefined): Promise<VoidResult> {
		const unanswered = await this.held.idle(timeout, signal);

		if (unanswered === 0) return {};

		this.log.warn('session - shutting down with messages unanswered', { timeout, unanswered });

		return { err: new Error(`Shut down with ${String(unanswered)} message(s) unanswered`) };
	}

	private async unhandled(pduObj: PduObject): Promise<void> {
		if (bindCommands.includes(pduObj.cmdName)) {
			this.log.info('session - bind on an already bound session', { cmdName: pduObj.cmdName });
			await this.session.sendReturn(pduObj, 'ESME_RALYBND', { system_id: this.systemId });

			return;
		}

		if (!respNameFor(pduObj.cmdName)) {
			this.log.verbose('session - ignoring a command SMPP gives no response', { cmdName: pduObj.cmdName });

			return;
		}

		this.log.info('session - no handler for command', { cmdName: pduObj.cmdName });
		await this.session.sendReturn(pduObj, 'ESME_RINVCMDID');
	}

	private carriedAs(pduObj: PduObject): string {
		return standsInFor(pduObj.cmdName, this.session.linkEnd);
	}

	/** SMPP carries a mobile-originated message and a delivery receipt on the same command. */
	private async onDelivery(pduObj: PduObject): Promise<void> {
		const dlr = dlrFromPdu(pduObj, this.smsIdFormat);

		if (!dlr) {
			await this.onMessage(pduObj);

			return;
		}

		this.session.emit('dlr', dlr, pduObj);

		const merged = this.dlrMerger.collect(dlr);

		if (merged) this.session.emit('messageDlr', merged);

		await this.session.sendReturn(pduObj);
	}

	private async refusedAtBound(pduObj: PduObject): Promise<boolean> {
		if (this.held.full()) {
			if (!this.refusing) {
				this.refusing = true;
				this.log.warn('session - unanswered messages at their bound, refusing new ones until the application answers', {
					messages: this.held.size,
					octets: this.held.octetsHeld,
				});
			}

			this.log.verbose('session - unanswered messages at their bound, asking the peer to retry', {
				cmdName: pduObj.cmdName,
				seqNr: pduObj.seqNr,
			});
			await this.session.sendReturn(pduObj, throttledStatus(this.carriedAs(pduObj)));

			return true;
		}

		// Half, so a peer keeping its window full does not flip this on every answer.
		if (
			this.refusing
			&& this.held.size <= defaults.maxHeldMessages / 2
			&& this.held.octetsHeld <= defaults.maxHeldOctets / 2
		) {
			this.refusing = false;
			this.log.info('session - unanswered messages down to half their bound, accepting again', { messages: this.held.size });
		}

		return false;
	}

	/**
	 * A concatenated message is answered segment by segment as it arrives: a peer that dispatches
	 * one request at a time never sends the second segment until the first has been answered.
	 */
	private async onMessage(pduObj: PduObject): Promise<void> {
		if (await this.refusedAtBound(pduObj)) return;

		const concat = concatOf(pduObj);

		if (!concat) {
			this.held.offer([detach(pduObj)]);

			return;
		}

		const collected = this.reassembler.collect(pduObj, concat);

		if (!collected.kept) {
			await this.session.sendReturn(
				pduObj,
				refusedSegmentStatus(this.carriedAs(pduObj), collected.refusal, concat.spelling),
			);

			return;
		}

		await this.session.sendReturn(
			pduObj,
			'ESME_ROK',
			respIdParams(pduObj.cmdName, segmentId(collected.smsId, concat.part - 1, concat.total)),
		);

		if (collected.whole) this.held.offer(collected.whole, collected.smsId);
	}

	private reportLost(lost: LostGroup): void {
		this.session.emit('sessionError', new Error(
			`Gave up ${String(lost.parts)} of ${String(lost.total)} segments of an incomplete concatenated message: ${lostReasons[lost.reason]}`,
		));
	}
}
