import { parse } from "tldts";

/**
 * FR-07: root domain (eTLD+1 from the Public Suffix List) of a normalized URL.
 * Also enables the "private" part of the PSL so sites on shared platforms (abc.github.io,
 * shop.vercel.app) are split per owner instead of being merged into github.io.
 * An IP, localhost or a bare public suffix (gov.vn) keeps the full host.
 */
export function rootDomainOf(url: string): string {
	const { hostname } = new URL(url);
	const parsed = parse(hostname, { allowPrivateDomains: true });
	if (parsed.isIp || !parsed.domain) return hostname;
	return parsed.domain;
}
