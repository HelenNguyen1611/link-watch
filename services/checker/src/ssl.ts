import { isIP } from "node:net";
import tls from "node:tls";
import {
	assertHostAllowed,
	createSafeLookup,
	type SsrfOptions,
} from "./safe-lookup";

/**
 * FR-17: SSL certificate expiry of a host. Only reads the certificate (no validation), so it works even for broken certificates.
 * Returns undefined when it cannot connect.
 */
export function getCertExpiry(
	host: string,
	port = 443,
	opts: SsrfOptions & { timeoutMs?: number } = {},
): Promise<Date | undefined> {
	const hostname = host.replace(/^\[|\]$/g, "");
	try {
		assertHostAllowed(host, opts);
	} catch {
		return Promise.resolve(undefined);
	}
	return new Promise((resolve) => {
		const socket = tls.connect({
			host: hostname,
			port,
			servername: isIP(hostname) ? undefined : hostname,
			rejectUnauthorized: false,
			lookup: createSafeLookup(opts),
			timeout: opts.timeoutMs ?? 5000,
		});
		const done = (d?: Date) => {
			socket.destroy();
			resolve(d);
		};
		socket.once("secureConnect", () => {
			const validTo = socket.getPeerCertificate()?.valid_to;
			done(validTo ? new Date(validTo) : undefined);
		});
		socket.once("error", () => done());
		socket.once("timeout", () => done());
	});
}
