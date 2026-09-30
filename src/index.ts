import { cmds, cmdsById } from './codec/commands.ts';
import { consts, constsById } from './codec/constants.ts';
import { encodings } from './codec/encodings.ts';
import { errors, errorsById } from './codec/statuses.ts';
import { tlvs, tlvsById } from './codec/tlvs.ts';
import { types } from './codec/field-types.ts';

export { client } from './client/client.ts';
export { server, SmppServer } from './server/server.ts';
export { Session } from './session.ts';

export { cmds, cmdsById, commandNameById, isCommandName } from './codec/commands.ts';
export { consts, constsById } from './codec/constants.ts';
export { dataCodingByEncoding, detect, encodingByDataCoding, encodings, isEncodingName, messageClassOf, unencodable } from './codec/encodings.ts';
export { errorNameById, errors, errorsById, isErrorName } from './codec/statuses.ts';
export { isTlvName, tlvs, tlvsById } from './codec/tlvs.ts';
export { types } from './codec/field-types.ts';

export {
	isCommand,
	isResp,
	maxSeqNr,
	objToPdu,
	pduReturn,
	pduToObj,
} from './codec/pdu.ts';

export { maxPduLength, PduRefusedError } from './codec/refusal.ts';

export {
	bitCount,
	decodeMessage,
	encodeMessage,
	smppDate,
	smppTime,
	splitMessage,
} from './message.ts';

export { dlrFromPdu, parseReceipt, receiptCodes } from './protocol/receipt.ts';
export { messageOctets } from './protocol/message-body.ts';
export { concatOf } from './protocol/concat.ts';
export { concatInfo } from './protocol/udh.ts';
export { PduFramer } from './codec/framer.ts';
export { uuidv7 } from './protocol/uuid.ts';

export type { BindType, ClientOptions } from './client/client.ts';
export type { Dlr, Receipt } from './protocol/receipt.ts';
export type { SendDlrResult, SendRespOptions, Sms } from './sms.ts';
export type { Concat } from './protocol/concat.ts';
export type { ConcatInfo } from './protocol/udh.ts';
export type { Result, VoidResult } from './result.ts';
export type { SmppLog } from './log.ts';
export type { SmsIdFormat, SmsIdNotation } from './protocol/message-ids.ts';
export type {
	AuthenticateInput,
	AuthenticateResult,
	ServerEvents,
	ServerOptions,
} from './server/server.ts';
export type {
	CloseOptions,
	MessageDlr,
	ReconnectOptions,
	SendOptions,
	SendSmsOptions,
	SendSmsResult,
	SessionEvents,
	SessionOptions,
} from './session.ts';
export type { CommandName, PduParams, PduParamsInput } from './codec/commands.ts';
export type { ConstGroup, MessageState, SubmitMessagingMode } from './codec/constants.ts';
export type { Encoding, EncodingName, Unencodable } from './codec/encodings.ts';
export type { ErrorName } from './codec/statuses.ts';
export type { PduObject, PduObjectInput, TlvInputs } from './codec/pdu.ts';
export type { PduHeader } from './codec/refusal.ts';
export type { SplitOptions } from './message.ts';
export type { Tlv, TlvDefinition, TlvName, Tlvs } from './codec/tlvs.ts';
export type { DestAddress, ParamValue, TlvValue, UnsuccessSme, WireType } from './codec/field-types.ts';

/** The spec tables, grouped the way `larvitsmpp.defs` was in 0.4.0. */
export const defs = {
	cmds,
	cmdsById,
	consts,
	constsById,
	encodings,
	errors,
	errorsById,
	tlvs,
	tlvsById,
	types,
};
