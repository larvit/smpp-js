import { server } from '../src/server.ts';

/**
 * Answers every submit_sm ESME_ROK and does nothing else, so a measurement against it reads this
 * library's own ceiling rather than an SMSC's storage. Prints the bound port on stdout, then waits.
 */
const port = Number(process.env.PORT ?? 0);
const { err, server: smpp } = await server({ port });

if (err) {
	process.stderr.write(`sink failed to listen: ${err.message}\n`);
	process.exit(1);
}

let answered = 0;

smpp.on('session', session => {
	session.on('sms', async sms => {
		answered++;
		await sms.sendResp();
	});
});

smpp.on('serverError', reason => {
	process.stderr.write(`sink serverError: ${reason.message}\n`);
});

process.stdout.write(`${JSON.stringify({ port: smpp.port })}\n`);

process.on('SIGTERM', () => {
	process.stderr.write(`sink answered ${String(answered)}\n`);
	void smpp.close({ signal: AbortSignal.abort() }).then(() => process.exit(0));
});
