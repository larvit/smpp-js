import type { ParamValue, TlvValue, WireType } from './types.ts';
import type { Result } from '../result.ts';
import { tlv } from './types.ts';

/** Only a tag read as octets or as a number may repeat, since its occurrences are listed as one of those. */
type Definition<Tag> = { id: number; multiple?: false; tag: Tag; type: WireType<Buffer | number | string> }
	| { id: number; multiple: true; tag: Tag; type: WireType<Buffer> | WireType<number> };

export type TlvDefinition = Definition<string>;

/** The constraint keys every definition to its own name, so a `tag` that drifts fails to compile. */
const tlvSpecs = <T extends { [K in keyof T]: Definition<K> }>(definitions: T): T => definitions;

// Ordered by tag id, mirroring the SMPP 5.0 TLV table.
const specs = tlvSpecs({
	dest_addr_subunit: { id: 0x0005, tag: 'dest_addr_subunit', type: tlv.int8 },
	dest_network_type: { id: 0x0006, tag: 'dest_network_type', type: tlv.int8 },
	dest_bearer_type: { id: 0x0007, tag: 'dest_bearer_type', type: tlv.int8 },
	dest_telematics_id: { id: 0x0008, tag: 'dest_telematics_id', type: tlv.int16 },
	source_addr_subunit: { id: 0x000D, tag: 'source_addr_subunit', type: tlv.int8 },
	source_network_type: { id: 0x000E, tag: 'source_network_type', type: tlv.int8 },
	source_bearer_type: { id: 0x000F, tag: 'source_bearer_type', type: tlv.int8 },
	source_telematics_id: { id: 0x0010, tag: 'source_telematics_id', type: tlv.int8 },
	qos_time_to_live: { id: 0x0017, tag: 'qos_time_to_live', type: tlv.int32 },
	payload_type: { id: 0x0019, tag: 'payload_type', type: tlv.int8 },
	additional_status_info_text: { id: 0x001D, tag: 'additional_status_info_text', type: tlv.cstring },
	receipted_message_id: { id: 0x001E, tag: 'receipted_message_id', type: tlv.cstring },
	ms_msg_wait_facilities: { id: 0x0030, tag: 'ms_msg_wait_facilities', type: tlv.int8 },
	privacy_indicator: { id: 0x0201, tag: 'privacy_indicator', type: tlv.int8 },
	source_subaddress: { id: 0x0202, tag: 'source_subaddress', type: tlv.buffer },
	dest_subaddress: { id: 0x0203, tag: 'dest_subaddress', type: tlv.buffer },
	user_message_reference: { id: 0x0204, tag: 'user_message_reference', type: tlv.int16 },
	user_response_code: { id: 0x0205, tag: 'user_response_code', type: tlv.int8 },
	source_port: { id: 0x020A, tag: 'source_port', type: tlv.int16 },
	dest_port: { id: 0x020B, tag: 'dest_port', type: tlv.int16 },
	sar_msg_ref_num: { id: 0x020C, tag: 'sar_msg_ref_num', type: tlv.int16 },
	language_indicator: { id: 0x020D, tag: 'language_indicator', type: tlv.int8 },
	sar_total_segments: { id: 0x020E, tag: 'sar_total_segments', type: tlv.int8 },
	sar_segment_seqnum: { id: 0x020F, tag: 'sar_segment_seqnum', type: tlv.int8 },
	sc_interface_version: { id: 0x0210, tag: 'sc_interface_version', type: tlv.int8 },
	callback_num_pres_ind: { id: 0x0302, multiple: true, tag: 'callback_num_pres_ind', type: tlv.int8 },
	callback_num_atag: { id: 0x0303, multiple: true, tag: 'callback_num_atag', type: tlv.buffer },
	number_of_messages: { id: 0x0304, tag: 'number_of_messages', type: tlv.int8 },
	callback_num: { id: 0x0381, multiple: true, tag: 'callback_num', type: tlv.buffer },
	dpf_result: { id: 0x0420, tag: 'dpf_result', type: tlv.int8 },
	set_dpf: { id: 0x0421, tag: 'set_dpf', type: tlv.int8 },
	ms_availability_status: { id: 0x0422, tag: 'ms_availability_status', type: tlv.int8 },
	network_error_code: { id: 0x0423, tag: 'network_error_code', type: tlv.buffer },
	message_payload: { id: 0x0424, tag: 'message_payload', type: tlv.buffer },
	delivery_failure_reason: { id: 0x0425, tag: 'delivery_failure_reason', type: tlv.int8 },
	more_messages_to_send: { id: 0x0426, tag: 'more_messages_to_send', type: tlv.int8 },
	message_state: { id: 0x0427, tag: 'message_state', type: tlv.int8 },
	congestion_state: { id: 0x0428, tag: 'congestion_state', type: tlv.int8 },
	ussd_service_op: { id: 0x0501, tag: 'ussd_service_op', type: tlv.int8 },
	broadcast_channel_indicator: { id: 0x0600, tag: 'broadcast_channel_indicator', type: tlv.int8 },
	broadcast_content_type: { id: 0x0601, tag: 'broadcast_content_type', type: tlv.buffer },
	broadcast_content_type_info: { id: 0x0602, tag: 'broadcast_content_type_info', type: tlv.string },
	broadcast_message_class: { id: 0x0603, tag: 'broadcast_message_class', type: tlv.int8 },
	broadcast_rep_num: { id: 0x0604, tag: 'broadcast_rep_num', type: tlv.int16 },
	broadcast_frequency_interval: { id: 0x0605, tag: 'broadcast_frequency_interval', type: tlv.buffer },
	broadcast_area_identifier: { id: 0x0606, multiple: true, tag: 'broadcast_area_identifier', type: tlv.buffer },
	broadcast_error_status: { id: 0x0607, multiple: true, tag: 'broadcast_error_status', type: tlv.int32 },
	broadcast_area_success: { id: 0x0608, tag: 'broadcast_area_success', type: tlv.int8 },
	broadcast_end_time: { id: 0x0609, tag: 'broadcast_end_time', type: tlv.string },
	broadcast_service_group: { id: 0x060A, tag: 'broadcast_service_group', type: tlv.string },
	billing_identification: { id: 0x060B, tag: 'billing_identification', type: tlv.buffer },
	source_network_id: { id: 0x060D, tag: 'source_network_id', type: tlv.cstring },
	dest_network_id: { id: 0x060E, tag: 'dest_network_id', type: tlv.cstring },
	source_node_id: { id: 0x060F, tag: 'source_node_id', type: tlv.string },
	dest_node_id: { id: 0x0610, tag: 'dest_node_id', type: tlv.string },
	dest_addr_np_resolution: { id: 0x0611, tag: 'dest_addr_np_resolution', type: tlv.int8 },
	dest_addr_np_information: { id: 0x0612, tag: 'dest_addr_np_information', type: tlv.string },
	dest_addr_np_country: { id: 0x0613, tag: 'dest_addr_np_country', type: tlv.int32 },
	display_time: { id: 0x1201, tag: 'display_time', type: tlv.int8 },
	sms_signal: { id: 0x1203, tag: 'sms_signal', type: tlv.int16 },
	ms_validity: { id: 0x1204, tag: 'ms_validity', type: tlv.buffer },
	alert_on_message_delivery: { id: 0x130C, tag: 'alert_on_message_delivery', type: tlv.int8 },
	its_reply_type: { id: 0x1380, tag: 'its_reply_type', type: tlv.int8 },
	its_session_info: { id: 0x1383, tag: 'its_session_info', type: tlv.buffer },
});

type Specs = typeof specs;

export type TlvName = keyof Specs;

// Alternate spellings; the definition behind each keeps its canonical name.
const alternates = {
	alert_on_msg_delivery: specs.alert_on_message_delivery,
	failed_broadcast_area_identifier: specs.broadcast_area_identifier,
};

export const tlvs: Record<TlvName, TlvDefinition> & Record<string, TlvDefinition> = { ...specs, ...alternates };

export const tlvsById: Record<number, TlvDefinition> = {};

for (const definition of Object.values<TlvDefinition>(specs)) {
	tlvsById[definition.id] = definition;
}

/** Fallback for tags this table does not know: keep the raw octets. */
export const tlvDefault: WireType<Buffer> = tlv.buffer;

type Repeated<K extends TlvName, V> = Specs[K] extends { multiple: true } ? V[] : V;

type WireValue<K extends TlvName> = Specs[K]['type']['default'];

type ReadValue<K extends TlvName> = Repeated<K, WireValue<K>>;

/** A lone text field also takes a number, and an octet field text, which goes out as latin1. */
type WriteValue<K extends TlvName> = Specs[K] extends { multiple: true } ? ReadValue<K>
	: WireValue<K> extends number ? number
	: WireValue<K> extends string ? number | string
	: Buffer | string;

type KnownTlv<K extends TlvName> = { tagId: number; tagName: K; tagValue: ReadValue<K> };

/** A tag the TLV table does not define. */
type UnknownTlv = { tagId: number; tagName: undefined; tagValue: Buffer };

/** Keyed by tag name, or by its decimal id where the table defines no name. */
export type Tlvs = { [K in TlvName]?: KnownTlv<K> } & Partial<Record<`${number}`, UnknownTlv>>;

export type Tlv = { [K in TlvName]: KnownTlv<K> }[TlvName] | UnknownTlv;

/** Keyed like `Tlvs`, by tag name or by the decimal id of a tag the table does not define. */
export type TlvInputs = { [K in TlvName]?: { tagValue: WriteValue<K> } }
	& Partial<Record<`${number}`, { tagValue: Buffer | string }>>;

function isTlvInput(input: unknown): input is { tagValue: TlvValue } {
	if (typeof input !== 'object' || input === null || !('tagValue' in input)) return false;

	const value = input.tagValue;

	if (!Array.isArray(value)) return Buffer.isBuffer(value) || typeof value === 'number' || typeof value === 'string';

	return value.every(one => Buffer.isBuffer(one)) || value.every(one => typeof one === 'number');
}

function keyedTagId(name: string): Result<{ tagId: number }> {
	if (isTlvName(name)) return { tagId: specs[name].id };

	const alternate = Object.hasOwn(tlvs, name) ? tlvs[name] : undefined;

	if (alternate) return { err: new Error(`TLV "${name}": key it ${alternate.tag}, the name it reads back under`) };

	if (!/^(0|[1-9]\d*)$/.test(name)) {
		return { err: new Error(`TLV "${name}": unknown tag name; key a tag the table does not define by its decimal id`) };
	}

	const tagId = Number(name);

	if (tagId > 0xFFFF) return { err: new Error(`TLV "${name}": tag id out of range 0-65535`) };

	const known = tlvsById[tagId];

	return known ? { err: new Error(`TLV "${name}": the table names this tag ${known.tag}, key it by that`) } : { tagId };
}

/** The key names the tag; a `tagId` beside it, as a parsed TLV carries, has to agree. */
function entryOf(name: string, input: unknown): Result<{ tagId: number; tagValue: TlvValue }> {
	if (!isTlvInput(input)) {
		return { err: new Error(`TLV "${name}": give it as { tagValue }, holding a Buffer, a number, a string, or an array of Buffers or of numbers`) };
	}

	const keyed = keyedTagId(name);

	if (keyed.err) return { err: keyed.err };

	if ('tagId' in input && input.tagId !== undefined && input.tagId !== keyed.tagId) {
		return { err: new Error(`TLV "${name}": its tagId is not ${String(keyed.tagId)}, the tag its key names; drop the tagId`) };
	}

	return { tagId: keyed.tagId, tagValue: input.tagValue };
}

/** Each TLV as its four octet header and the value the tag's own wire type writes. */
export function writeTlvs(inputs: TlvInputs | undefined): Result<{ chunks: Buffer[] }> {
	const chunks: Buffer[] = [];

	for (const [name, input] of Object.entries<unknown>(inputs ?? {})) {
		const tag = entryOf(name, input);

		if (tag.err) return { err: tag.err };

		const definition = tlvsById[tag.tagId];
		const values = occurrences(tag.tagValue, definition?.multiple === true);

		if (values.err) return { err: new Error(`TLV "${name}": ${values.err.message}`) };

		for (const value of values.values) {
			const chunk = writeTlv(tag.tagId, definition?.type ?? tlvDefault, value);

			if (chunk.err) return { err: new Error(`TLV "${name}": ${chunk.err.message}`) };

			chunks.push(chunk.chunk);
		}
	}

	return { chunks };
}

function occurrences(value: TlvValue, multiple: boolean): Result<{ values: ParamValue[] }> {
	if (!multiple) {
		return Array.isArray(value) ? { err: new Error('takes one value, not an array') } : { values: [value] };
	}

	if (!Array.isArray(value)) return { err: new Error('is repeatable, wrap it in an array: [value]') };

	if (value.length === 0) return { err: new Error('holds no values, omit it instead') };

	return { values: value };
}

function writeTlv(tagId: number, type: WireType, value: ParamValue): Result<{ chunk: Buffer }> {
	if (type === tlvDefault && typeof value === 'number') {
		return { err: new Error('holds octets, which a number would write as its digits; give a Buffer or a string') };
	}

	const sized = type.size(value);

	if (sized.err) return { err: sized.err };

	if (sized.size > 0xffff) {
		return { err: new Error(`${String(sized.size)} octets overflow the two octet length`) };
	}

	const chunk = Buffer.alloc(sized.size + 4);

	chunk.writeUInt16BE(tagId, 0);
	chunk.writeUInt16BE(sized.size, 2);

	const written = type.write(value, chunk, 4);

	return written.err ? { err: written.err } : { chunk };
}

type Occurrence = { definition: TlvDefinition | undefined; tagId: number; value: Buffer | number | string };

function readTlv(pdu: Buffer, offset: number): Result<{ octets: number; occurrence: Occurrence }> {
	const tagId = pdu.readUInt16BE(offset);
	const tagLength = pdu.readUInt16BE(offset + 2);

	if (offset + 4 + tagLength > pdu.length) {
		return { err: new Error(`TLV ${String(tagId)} runs past the end of the PDU`) };
	}

	const definition = tlvsById[tagId];
	const read = (definition?.type ?? tlvDefault).read(pdu, offset + 4, tagLength);

	if (read.err) return { err: read.err };

	// Copied, so holding a TLV pins no more than its own octets.
	const value = Buffer.isBuffer(read.value) ? Buffer.from(read.value) : read.value;

	return { occurrence: { definition, tagId, value }, octets: 4 + tagLength };
}

function isTlvName(name: string): name is TlvName {
	return Object.hasOwn(specs, name);
}

function readsAs(definition: TlvDefinition, value: unknown): boolean {
	const kind = definition.type.default;
	const fits = (one: unknown): boolean => typeof one === typeof kind && Buffer.isBuffer(one) === Buffer.isBuffer(kind);

	return definition.multiple === true ? Array.isArray(value) && value.every(fits) : fits(value);
}

function isTlvShape(tlv: unknown): tlv is { tagId: number; tagName: unknown; tagValue: unknown } {
	return typeof tlv === 'object' && tlv !== null && 'tagId' in tlv && typeof tlv.tagId === 'number'
		&& 'tagName' in tlv && 'tagValue' in tlv;
}

function isTlv(key: string, tlv: unknown): boolean {
	if (!isTlvShape(tlv)) return false;
	if (tlv.tagName === undefined) return /^\d+$/.test(key) && Buffer.isBuffer(tlv.tagValue);

	return tlv.tagName === key && isTlvName(key) && readsAs(specs[key], tlv.tagValue);
}

function isTlvs(record: Record<string, unknown>): record is Tlvs {
	return Object.entries(record).every(([key, tlv]) => isTlv(key, tlv));
}

/** Keyed by tag name, a repeatable tag listing every occurrence in wire order and any other keeping its last. */
function keyedTlvs(occurrences: Occurrence[]): Result<{ tlvs: Tlvs }> {
	const repeated = new Map<string, { tagId: number; values: Occurrence['value'][] }>();
	const tlvs: Record<string, unknown> = {};

	for (const { definition, tagId, value } of occurrences) {
		const key = definition?.tag ?? tagId.toString();

		if (definition?.multiple === true) {
			const entry = repeated.get(key) ?? { tagId, values: [] };

			entry.values.push(value);
			repeated.set(key, entry);
		} else {
			tlvs[key] = { tagId, tagName: definition?.tag, tagValue: value };
		}
	}

	for (const [key, { tagId, values }] of repeated) {
		tlvs[key] = { tagId, tagName: key, tagValue: values };
	}

	return isTlvs(tlvs) ? { tlvs } : { err: new Error('A TLV did not read as its table type, a defect in this library') };
}

export function parseTlvs(pdu: Buffer, start: number): Result<{ offset: number; tlvs: Tlvs }> {
	const occurrences: Occurrence[] = [];
	let offset = start;

	while (offset + 4 <= pdu.length) {
		const read = readTlv(pdu, offset);

		if (read.err) return { err: read.err };

		occurrences.push(read.occurrence);
		offset += read.octets;
	}

	const keyed = keyedTlvs(occurrences);

	return keyed.err ? { err: keyed.err } : { offset, tlvs: keyed.tlvs };
}
