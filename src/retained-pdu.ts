import type { ParamValue } from './defs/types.ts';
import type { PduObject } from './pdu.ts';
import type { Tlv } from './defs/tlvs.ts';
import { detachedTlv, tlvOctets } from './defs/types.ts';

/** Wire reads hand back views, so retaining one PDU would pin the whole chunk it arrived in. */
export function detach(pduObj: PduObject): PduObject {
	const params: Record<string, ParamValue> = {};
	const tlvs: Record<string, Tlv> = {};

	for (const [name, value] of Object.entries(pduObj.params)) {
		params[name] = Buffer.isBuffer(value) ? Buffer.from(value) : value;
	}

	for (const [name, tlv] of Object.entries(pduObj.tlvs)) {
		tlvs[name] = { ...tlv, tagValue: detachedTlv(tlv.tagValue) };
	}

	// short_message holds the same octets wherever it was not decoded, so one copy covers both.
	const octets = Buffer.isBuffer(params.short_message)
		? params.short_message
		: pduObj.shortMessageOctets && Buffer.from(pduObj.shortMessageOctets);

	return { ...pduObj, params, shortMessageOctets: octets, tlvs };
}

// Measured heap beyond the octets, so a PDU of empty fields or empty TLVs is not free.
const pduObjectOverhead = 1000;
const tlvObjectOverhead = 300;

// A cstring param arrives as a string, and source_addr alone can carry most of a 1 MiB PDU.
function sizeOf(value: ParamValue): number {
	if (Buffer.isBuffer(value)) return value.length;

	return typeof value === 'string' ? value.length : 0;
}

/** Roughly the heap a detached PDU holds. */
export function retainedOctets(pduObj: PduObject): number {
	let octets = pduObjectOverhead;

	for (const value of Object.values(pduObj.params)) {
		octets += sizeOf(value);
	}

	for (const tlv of Object.values(pduObj.tlvs)) {
		const listed = Array.isArray(tlv.tagValue) ? tlv.tagValue.length : 0;

		octets += tlvOctets(tlv.tagValue) + (1 + listed) * tlvObjectOverhead;
	}

	return octets;
}
