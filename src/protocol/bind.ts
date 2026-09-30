import type { Result } from '../result.ts';
import { quoted } from '../result.ts';

export const bindCommands: readonly string[] = [
	'bind_receiver',
	'bind_transceiver',
	'bind_transmitter',
];

export type BindType = 'receiver' | 'transceiver' | 'transmitter';

/** Which end of the link a session is. Only `server()` is the SMSC; everything else is the ESME. */
export type LinkEnd = 'esme' | 'smsc';

export function bindTypeFromCommand(cmdName: string): BindType | undefined {
	if (cmdName === 'bind_receiver') return 'receiver';
	if (cmdName === 'bind_transceiver') return 'transceiver';
	if (cmdName === 'bind_transmitter') return 'transmitter';

	return undefined;
}

/**
 * Which message-carrying command an inbound one stands in for. Every command but `data_sm` names
 * its own direction; that one travels either way, so the end it arrived at is what says.
 */
export function standsInFor(cmdName: string, linkEnd: LinkEnd): string {
	if (cmdName !== 'data_sm') return cmdName;

	return linkEnd === 'smsc' ? 'submit_sm' : 'deliver_sm';
}

/**
 * Whether a bind direction carries a command at all. A receiver-bound ESME submits nothing and a
 * transmitter-bound one is delivered nothing, whichever end of the link is looking. A session that
 * has not bound carries everything, since nothing has declared a direction yet.
 */
export function bindCarries(
	bindType: BindType | undefined,
	cmdName: string,
	linkEnd: LinkEnd,
): boolean {
	const carried = standsInFor(cmdName, linkEnd);

	if (bindType === 'receiver') return carried !== 'submit_sm';
	if (bindType === 'transmitter') return carried !== 'deliver_sm';

	return true;
}

/** SMPP 3.4: a peer that declares no version at all is one from before optional parameters. */
export const undeclaredInterfaceVersion = 0x00;

export type SessionBind = { as: BindType; peerVersion: number };

function isBindType(value: unknown): value is BindType {
	return typeof value === 'string' && bindTypeFromCommand(`bind_${value}`) !== undefined;
}

/** A bind as `Session.bound()` records it: undefined declares no version, which is pre-3.4. */
export function checkedBind(bindType: unknown, declaredVersion: unknown): Result<{ bind: SessionBind }> {
	if (!isBindType(bindType)) {
		return { err: new Error(`bindType must be receiver, transceiver or transmitter, the bind command's name without "bind_", got ${quoted(bindType)}`) };
	}

	if (declaredVersion === undefined) return { bind: { as: bindType, peerVersion: undeclaredInterfaceVersion } };

	if (typeof declaredVersion !== 'number' || !Number.isInteger(declaredVersion) || declaredVersion < 0 || declaredVersion > 0xFF) {
		return { err: new Error(`declaredVersion must be an integer 0-255, the interface_version param or the sc_interface_version TLV's tagValue, or undefined where the peer declared none, got ${quoted(declaredVersion)}`) };
	}

	return { bind: { as: bindType, peerVersion: declaredVersion } };
}
