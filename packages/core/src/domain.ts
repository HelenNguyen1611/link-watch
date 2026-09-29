import { parse } from "tldts";

/**
 * FR-07: domain chính (eTLD+1 theo Public Suffix List) của một URL đã chuẩn hóa.
 * Bật cả phần "private" của PSL để site trên nền tảng dùng chung (abc.github.io,
 * shop.vercel.app) được tách theo chủ thay vì gộp vào github.io.
 * Host là IP, localhost hoặc chính là public suffix (gov.vn) thì dùng nguyên host.
 */
export function rootDomainOf(url: string): string {
	const { hostname } = new URL(url);
	const parsed = parse(hostname, { allowPrivateDomains: true });
	if (parsed.isIp || !parsed.domain) return hostname;
	return parsed.domain;
}
