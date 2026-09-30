import type { CommandDefinition, CommandName, PduParams, PduParamsInput } from './commands.ts';
import type { ErrorName } from './errors.ts';
import type { ParamValue } from './types.ts';
import type { PduHeader } from './refusal.ts';
import type { Result, VoidResult } from '../result.ts';
import type { TlvInputs, Tlvs } from './tlvs.ts';
import { PduRefusedError, framingRefusal } from './refusal.ts';
import { cmds, commandNameById, respNameFor } from './commands.ts';
import { hasUdh } from './constants.ts';
import { decodeMessage, encodeBody } from '../message.ts';
import { errorNameById, errors, isErrorName } from './errors.ts';
import { paramNumber, valueText } from './types.ts';
import { parseTlvs, writeTlvs } from './tlvs.ts';

/** The highest sequence number this library hands out; SMPP 3.4 4.7.1 reserves 0x7fffffff. */
export const maxSeqNr = 2147483646;

/** What the field holds. Read and echoed in full, because peers do write above the spec's range. */
const maxWireSeqNr = 0xFFFFFFFF;

export type PduObjectInput<C extends CommandName = CommandName> = {
	cmdName: C;
	cmdStatus?: ErrorName;
	params?: PduParamsInput<C>;
	seqNr?: number;
	tlvs?: TlvInputs | undefined;
};

/**
 * A parsed PDU. `params` is loosely typed because the command is only known at runtime — narrow it
 * with `isCommand()` to get the parameters of a specific command.
 */
export type PduObject = {
	cmdId: number;
	cmdLength: number;
	cmdName: CommandName;
	cmdStatus: ErrorName | undefined;
	cmdStatusId: number;
	params: Record<string, ParamValue>;
	seqNr: number;
	/**
	 * short_message as it arrived, whatever data_coding turned `params.short_message` into. A body
	 * the peer put in `message_payload` is not here; `messageOctets()` is what reads either.
	 */
	shortMessageOctets: Buffer | undefined;
	tlvs: Tlvs;
};

export type { TlvInputs };

const respBit = 0x80000000;

export function isResp(pduObj: Pick<PduObject, 'cmdId'>): boolean {
	return pduObj.cmdId >= respBit;
}

/**
 * Narrows a parsed PDU to one command, giving its parameters their real types. The parser fills
 * every parameter the command declares with the type that command declares, which is what makes
 * this sound.
 */
export function isCommand<C extends CommandName>(
	pduObj: PduObject,
	cmdName: C,
): pduObj is PduObject & { cmdName: C; params: PduParams<C> } {
	return pduObj.cmdName === cmdName;
}

type ResolvedBody = {
	params: Record<string, ParamValue | undefined>;
	tlvs: TlvInputs | undefined;
};

/**
 * What the PDU's data_coding describes, and so what may set it: short_message wherever it holds an
 * octet, since messageOctets() reads it there, and message_payload only where it does not.
 */
type CodingSource = 'message_payload' | 'short_message';

function codingOf(params: Record<string, ParamValue | undefined>): number | undefined {
	return typeof params.data_coding === 'number' ? params.data_coding : undefined;
}

function resolveShortMessage(
	params: Record<string, ParamValue | undefined>,
	definition: CommandDefinition,
): Result<{ params: Record<string, ParamValue | undefined>; source: CodingSource }> {
	// Only the short_message the command's own table will write, since writeParams() ignores any other.
	const message = definition.params?.short_message === undefined ? undefined : params.short_message;

	if (Buffer.isBuffer(message)) {
		return {
			params: params.sm_length === undefined ? { ...params, sm_length: message.length } : params,
			source: message.length > 0 ? 'short_message' : 'message_payload',
		};
	}

	if (typeof message !== 'string') return { params, source: 'message_payload' };

	const encoded = encodeBody(message, codingOf(params));

	if (encoded.err) {
		return { err: new Error(`Parameter "short_message" of "${definition.command}": ${encoded.err.message}`) };
	}

	const written = { ...params, short_message: encoded.buffer, sm_length: encoded.buffer.length };

	if (encoded.buffer.length === 0) return { params: written, source: 'message_payload' };

	return { params: { ...written, data_coding: encoded.dataCoding }, source: 'short_message' };
}

function resolveBody(
	params: Record<string, ParamValue | undefined>,
	tlvs: TlvInputs | undefined,
	definition: CommandDefinition,
): Result<ResolvedBody> {
	const shortMessage = resolveShortMessage(params, definition);

	if (shortMessage.err) return { err: shortMessage.err };

	const text = tlvs?.message_payload?.tagValue;

	if (typeof text !== 'string') return { params: shortMessage.params, tlvs };

	const encoded = encodeBody(text, codingOf(shortMessage.params));

	if (encoded.err) return { err: new Error(`TLV "message_payload": ${encoded.err.message}`) };

	return {
		params: shortMessage.source === 'message_payload'
			? { ...shortMessage.params, data_coding: encoded.dataCoding }
			: shortMessage.params,
		tlvs: { ...tlvs, message_payload: { tagValue: encoded.buffer } },
	};
}

function writeParams(
	definition: CommandDefinition,
	resolved: Record<string, ParamValue | undefined>,
	cmdName: CommandName,
): Result<{ chunks: Buffer[] }> {
	const chunks: Buffer[] = [];

	for (const [name, type] of Object.entries(definition.params ?? {})) {
		const value = resolved[name] ?? type.default;
		const sized = type.size(value);

		if (sized.err) {
			return { err: new Error(`Parameter "${name}" of "${cmdName}": ${sized.err.message}`) };
		}

		const chunk = Buffer.alloc(sized.size);
		const written = type.write(value, chunk, 0);

		if (written.err) {
			return { err: new Error(`Parameter "${name}" of "${cmdName}": ${written.err.message}`) };
		}

		chunks.push(chunk);
	}

	return { chunks };
}

/**
 * SMPP 3.4: a response reporting a failure carries no body, so its fields are not "unused but
 * present" — they are absent, and a peer that reads them anyway reads past the end of the PDU.
 */
function buildBody(
	definition: CommandDefinition,
	cmdName: CommandName,
	cmdStatus: ErrorName,
	params: Record<string, ParamValue | undefined>,
	tlvs: TlvInputs | undefined,
): Result<{ body: Buffer }> {
	if (errors[cmdStatus] !== 0 && definition.id >= respBit) return { body: Buffer.alloc(0) };

	const body = resolveBody(params, tlvs, definition);

	if (body.err) return { err: body.err };

	const written = writeParams(definition, body.params, cmdName);

	if (written.err) return { err: written.err };

	const writtenTlvs = writeTlvs(body.tlvs);

	if (writtenTlvs.err) return { err: writtenTlvs.err };

	return { body: Buffer.concat([...written.chunks, ...writtenTlvs.chunks]) };
}

function buildPdu(
	cmdName: CommandName,
	cmdStatus: ErrorName,
	seqNr: number,
	params: Record<string, ParamValue | undefined>,
	tlvs: TlvInputs | undefined,
): Result<{ buffer: Buffer }> {
	const definition = cmds[cmdName];

	if (!definition) {
		return { err: new Error(`Invalid cmdName: ${JSON.stringify(cmdName)}`) };
	}

	if (!isErrorName(cmdStatus)) {
		return { err: new Error(`Invalid cmdStatus: ${JSON.stringify(cmdStatus)}`) };
	}

	if (!Number.isInteger(seqNr) || seqNr < 0 || seqNr > maxWireSeqNr) {
		return { err: new Error(`Invalid seqNr: ${valueText(seqNr)}`) };
	}

	const built = buildBody(definition, cmdName, cmdStatus, params, tlvs);

	if (built.err) return { err: built.err };

	const body = built.body;
	const header = Buffer.alloc(16);

	header.writeUInt32BE(body.length + 16, 0);
	header.writeUInt32BE(definition.id, 4);
	header.writeUInt32BE(errors[cmdStatus], 8);
	header.writeUInt32BE(seqNr, 12);

	return { buffer: Buffer.concat([header, body]) };
}

export function objToPdu<C extends CommandName>(obj: PduObjectInput<C>): Result<{ buffer: Buffer }> {
	return buildPdu(
		obj.cmdName,
		obj.cmdStatus ?? 'ESME_ROK',
		obj.seqNr ?? 1,
		{ ...obj.params },
		obj.tlvs,
	);
}

function readParams(
	cmdName: CommandName,
	pdu: Buffer,
): Result<{ lastParam: string | undefined; offset: number; params: Record<string, ParamValue> }> {
	const params: Record<string, ParamValue> = {};
	let lastParam: string | undefined;
	let offset = 16;

	for (const [name, type] of Object.entries(cmds[cmdName]?.params ?? {})) {
		const read = type.read(pdu, offset, paramNumber(params.sm_length, 0));

		if (read.err) {
			return { err: new Error(`Parameter "${name}" of "${cmdName}": ${read.err.message}`) };
		}

		lastParam = name;
		params[name] = read.value;
		offset += read.bytesRead;
	}

	return { lastParam, offset, params };
}

/**
 * SMPP 3.4 4.3: the optional parameters run to command_length exactly, so an octet left over is a
 * TLV stream this codec could not read rather than slack to drop.
 */
function readOptionalParams(
	pdu: Buffer,
	start: number,
	afterShortMessage: boolean,
): Result<{ tlvs: Tlvs }> {
	const plain = parseTlvs(pdu, start);

	if (!plain.err && plain.offset === pdu.length) return { tlvs: plain.tlvs };

	// Some peers append a NULL octet after short_message; that octet, and no other, is skipped.
	if (afterShortMessage && pdu[start] === 0) {
		const padded = parseTlvs(pdu, start + 1);

		if (!padded.err && padded.offset === pdu.length) return { tlvs: padded.tlvs };
	}

	return {
		err: plain.err ?? new Error(
			`${String(pdu.length - plain.offset)} octets are left over after the optional parameters`,
		),
	};
}

function headerOf(pdu: Buffer): PduHeader {
	const cmdId = pdu.readUInt32BE(4);

	return {
		cmdId,
		cmdLength: pdu.readUInt32BE(0),
		cmdName: commandNameById(cmdId),
		cmdStatusId: pdu.readUInt32BE(8),
		seqNr: pdu.readUInt32BE(12),
	};
}

function parsePdu(pdu: Buffer): Result<{ pduObj: PduObject }> {
	const header = headerOf(pdu);
	const { cmdId, cmdLength, cmdName, cmdStatusId, seqNr } = header;

	if (!cmdName) {
		return { err: new PduRefusedError(header, 'command', new Error('Unknown PDU command id')) };
	}

	const declared = pdu.subarray(0, cmdLength);
	// SMPP 3.4 4.4.2 and friends: a response with a non-zero status carries no body at all.
	const read = cmdStatusId !== 0 && cmdLength === 16
		? { lastParam: undefined, offset: 16, params: {} }
		: readParams(cmdName, declared);

	if (read.err) return { err: new PduRefusedError(header, 'body', read.err) };

	const params = read.params;
	const message = params.short_message;
	const octets = Buffer.isBuffer(message) ? message : undefined;
	const parsed = readOptionalParams(declared, read.offset, read.lastParam === 'short_message');

	if (parsed.err) return { err: new PduRefusedError(header, 'tlvs', parsed.err) };

	// A message carrying a UDH stays a buffer; the session needs the header intact to reassemble.
	if (octets && !hasUdh(paramNumber(params.esm_class, 0))) {
		params.short_message = decodeMessage(octets, paramNumber(params.data_coding, 0)).message;
	}

	return {
		pduObj: {
			cmdId,
			cmdLength,
			cmdName,
			cmdStatus: errorNameById(cmdStatusId),
			cmdStatusId,
			params,
			seqNr,
			shortMessageOctets: octets,
			tlvs: parsed.tlvs,
		},
	};
}

function checkFraming(pdu: Buffer): VoidResult {
	if (pdu.length < 16) {
		return { err: new Error(`PDU is too short, minimum is 16 octets, got ${String(pdu.length)}`) };
	}

	const cmdLength = pdu.readUInt32BE(0);
	const unframable = framingRefusal(cmdLength);

	if (unframable) return { err: unframable };

	if (cmdLength > pdu.length) {
		return { err: new Error(`cmd_length ${String(cmdLength)} exceeds the ${String(pdu.length)} octets given`) };
	}

	return {};
}

export function pduToObj(pdu: Buffer): Result<{ pduObj: PduObject }> {
	const framing = checkFraming(pdu);

	if (framing.err) return { err: framing.err };

	return parsePdu(pdu);
}

/**
 * Fields the response shares with the request are echoed back unless the caller overrode them, so a
 * response that has to state its own value for one — an SMSC's system_id — must pass it.
 */
function echoParams(
	respName: CommandName,
	pdu: PduObject,
	params: Record<string, ParamValue>,
): Record<string, ParamValue> {
	const respParams: Record<string, ParamValue> = { ...params };

	for (const name of Object.keys(cmds[respName]?.params ?? {})) {
		const value = pdu.params[name];

		if (respParams[name] === undefined && value !== undefined) {
			respParams[name] = value;
		}
	}

	return respParams;
}

export function pduReturn(
	pdu: Buffer | PduObject,
	status: ErrorName = 'ESME_ROK',
	params: Record<string, ParamValue> = {},
	tlvs?: TlvInputs,
): Result<{ buffer: Buffer }> {
	if (Buffer.isBuffer(pdu)) {
		const parsed = pduToObj(pdu);

		return parsed.err ? { err: parsed.err } : pduReturn(parsed.pduObj, status, params, tlvs);
	}

	const respName = respNameFor(pdu.cmdName);

	if (!respName) {
		return { err: new Error(`"${pdu.cmdName}" has no response command`) };
	}

	return buildPdu(respName, status, pdu.seqNr, echoParams(respName, pdu, params), tlvs);
}
