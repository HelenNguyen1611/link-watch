import dns from "node:dns";
import type { LookupFunction } from "node:net";
import { isForbiddenHostname, isPrivateIp } from "@linkwatch/core";

/** NFR-07: SSRF blocking options. All private addresses are blocked by default. */
export type SsrfOptions = {
	/** Admin allows checking private addresses (globally). */
	allowPrivate?: boolean;
	/** Admin allows these specific hosts. */
	allowHosts?: string[];
};

export class BlockedAddressError extends Error {
	readonly code = "BLOCKED_PRIVATE_ADDRESS";
	constructor(host: string, address?: string) {
		super(
			address
				? `${host} → ${address} is a private address`
				: `${host} is a private address`,
		);
		this.name = "BlockedAddressError";
	}
}

export const isHostAllowed = (host: string, opts: SsrfOptions) =>
	opts.allowPrivate === true ||
	(opts.allowHosts ?? []).includes(host.toLowerCase());

/** Block before DNS resolution: literal private IPs, localhost, *.internal… */
export function assertHostAllowed(host: string, opts: SsrfOptions): void {
	if (!isHostAllowed(host, opts) && isForbiddenHostname(host))
		throw new BlockedAddressError(host);
}

/**
 * Block after DNS resolution, at connect time (prevents DNS rebinding):
 * used as the `lookup` for net/tls/undici.
 */
export function createSafeLookup(opts: SsrfOptions): LookupFunction {
	return ((
		hostname: string,
		options: dns.LookupOptions,
		callback: (...args: unknown[]) => void,
	) => {
		dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
			if (err) return callback(err);
			if (!isHostAllowed(hostname, opts)) {
				const bad = addresses.find((a) => isPrivateIp(a.address));
				if (bad)
					return callback(new BlockedAddressError(hostname, bad.address));
			}
			if (options?.all) return callback(null, addresses);
			const first = addresses[0];
			return callback(null, first.address, first.family);
		});
	}) as unknown as LookupFunction;
}
