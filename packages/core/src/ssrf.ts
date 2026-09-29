/**
 * NFR-07: detects private/special addresses so the Checker never calls into internal networks (SSRF).
 * Plain JS (no node:net) because core is shared with the web app.
 */

export type ParsedIp =
	| { version: 4; bytes: number[] }
	| { version: 6; words: number[] };

type V4Range = [number, number, number, number, number]; // a.b.c.d/prefix
type V6Range = [number[], number]; // words/prefix

const PRIVATE_V4: V4Range[] = [
	[0, 0, 0, 0, 8], // "this network"
	[10, 0, 0, 0, 8],
	[100, 64, 0, 0, 10], // CGNAT
	[127, 0, 0, 0, 8],
	[169, 254, 0, 0, 16], // link-local, metadata EC2
	[172, 16, 0, 0, 12],
	[192, 0, 0, 0, 24],
	[192, 0, 2, 0, 24], // TEST-NET-1
	[192, 168, 0, 0, 16],
	[198, 18, 0, 0, 15], // benchmark
	[198, 51, 100, 0, 24], // TEST-NET-2
	[203, 0, 113, 0, 24], // TEST-NET-3
	[224, 0, 0, 0, 4], // multicast
	[240, 0, 0, 0, 4], // reserved + broadcast
];

const PRIVATE_V6: V6Range[] = [
	[[0, 0, 0, 0, 0, 0, 0, 0], 128], // ::
	[[0, 0, 0, 0, 0, 0, 0, 1], 128], // ::1
	[[0xfc00], 7], // unique local (includes EC2's fd00:ec2::254)
	[[0xfe80], 10], // link-local
	[[0xff00], 8], // multicast
	[[0x2001, 0x0db8], 32], // documentation
];

function parseV4(s: string): number[] | null {
	const parts = s.split(".");
	if (parts.length !== 4) return null;
	const bytes: number[] = [];
	for (const p of parts) {
		if (!/^\d{1,3}$/.test(p)) return null;
		const n = Number(p);
		if (n > 255) return null;
		bytes.push(n);
	}
	return bytes;
}

function parseV6(input: string): number[] | null {
	let s = input;
	// Trailing embedded IPv4 (e.g. ::ffff:127.0.0.1) → convert to 2 hex groups
	const lastColon = s.lastIndexOf(":");
	if (s.includes(".", lastColon)) {
		const v4 = parseV4(s.slice(lastColon + 1));
		if (!v4) return null;
		const hi = ((v4[0] << 8) | v4[1]).toString(16);
		const lo = ((v4[2] << 8) | v4[3]).toString(16);
		s = `${s.slice(0, lastColon + 1)}${hi}:${lo}`;
	}
	const halves = s.split("::");
	if (halves.length > 2) return null;
	const toWords = (h: string) => (h === "" ? [] : h.split(":"));
	const head = toWords(halves[0]);
	const rest = halves.length === 2 ? toWords(halves[1]) : [];
	const parts = [...head, ...rest];
	if (!parts.every((w) => /^[0-9a-f]{1,4}$/i.test(w))) return null;
	if (halves.length === 1 ? parts.length !== 8 : parts.length > 7) return null;
	const zeros = new Array<string>(8 - parts.length).fill("0");
	return [...head, ...(halves.length === 2 ? zeros : []), ...rest].map((w) =>
		Number.parseInt(w, 16),
	);
}

/** Parses IPv4 or IPv6 (brackets accepted as in a URL); not an IP → null. */
export function parseIp(input: string): ParsedIp | null {
	const s =
		input.startsWith("[") && input.endsWith("]") ? input.slice(1, -1) : input;
	const v4 = parseV4(s);
	if (v4) return { version: 4, bytes: v4 };
	if (!s.includes(":")) return null;
	const v6 = parseV6(s);
	return v6 ? { version: 6, words: v6 } : null;
}

function inV4(bytes: number[], [a, b, c, d, prefix]: V4Range): boolean {
	const ip =
		((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
	const net = ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
	const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
	return (ip & mask) === (net & mask);
}

function inV6(words: number[], [net, prefix]: V6Range): boolean {
	for (let i = 0; i < 8 && prefix > 0; i++, prefix -= 16) {
		const bits = Math.min(prefix, 16);
		const mask = (0xffff << (16 - bits)) & 0xffff;
		if ((words[i] & mask) !== ((net[i] ?? 0) & mask)) return false;
	}
	return true;
}

function isPrivateV4(bytes: number[]): boolean {
	return PRIVATE_V4.some((r) => inV4(bytes, r));
}

/** NFR-07: true if the IP is in a private/special range. Throws if the string is not an IP. */
export function isPrivateIp(input: string): boolean {
	const ip = parseIp(input);
	if (!ip) throw new Error(`Not an IP address: ${input}`);
	if (ip.version === 4) return isPrivateV4(ip.bytes);
	const w = ip.words;
	const embeddedV4 = [w[6] >> 8, w[6] & 0xff, w[7] >> 8, w[7] & 0xff];
	// ::ffff:a.b.c.d (IPv4-mapped) and 64:ff9b::a.b.c.d (NAT64) → check the embedded IPv4
	if (w.slice(0, 5).every((x) => x === 0) && w[5] === 0xffff) {
		return isPrivateV4(embeddedV4);
	}
	if (w[0] === 0x64 && w[1] === 0xff9b && w.slice(2, 6).every((x) => x === 0)) {
		return isPrivateV4(embeddedV4);
	}
	return PRIVATE_V6.some((r) => inV6(w, r));
}

const FORBIDDEN_SUFFIXES = [".localhost", ".local", ".internal"];

/** NFR-07: blocks by hostname before DNS resolution (localhost, *.internal, private IPs). */
export function isForbiddenHostname(hostname: string): boolean {
	const host = hostname.toLowerCase();
	if (parseIp(host)) return isPrivateIp(host);
	return (
		host === "localhost" || FORBIDDEN_SUFFIXES.some((s) => host.endsWith(s))
	);
}
