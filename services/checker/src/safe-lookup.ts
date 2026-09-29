import dns from "node:dns";
import type { LookupFunction } from "node:net";
import { isForbiddenHostname, isPrivateIp } from "@linkwatch/core";

/** NFR-07: tùy chọn chặn SSRF. Mặc định chặn mọi địa chỉ nội bộ. */
export type SsrfOptions = {
	/** Admin cho phép check địa chỉ nội bộ (toàn cục). */
	allowPrivate?: boolean;
	/** Admin cho phép riêng các host này. */
	allowHosts?: string[];
};

export class BlockedAddressError extends Error {
	readonly code = "BLOCKED_PRIVATE_ADDRESS";
	constructor(host: string, address?: string) {
		super(
			address
				? `${host} → ${address} là địa chỉ nội bộ`
				: `${host} là địa chỉ nội bộ`,
		);
		this.name = "BlockedAddressError";
	}
}

export const isHostAllowed = (host: string, opts: SsrfOptions) =>
	opts.allowPrivate === true ||
	(opts.allowHosts ?? []).includes(host.toLowerCase());

/** Chặn trước khi phân giải DNS: IP nội bộ viết thẳng, localhost, *.internal… */
export function assertHostAllowed(host: string, opts: SsrfOptions): void {
	if (!isHostAllowed(host, opts) && isForbiddenHostname(host))
		throw new BlockedAddressError(host);
}

/**
 * Chặn sau khi phân giải DNS, ngay trong lúc kết nối (tránh DNS rebinding):
 * dùng làm `lookup` cho net/tls/undici.
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
