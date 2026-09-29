import {
	containsKeyword,
	type HttpMethod,
	type ProbeResult,
} from "@linkwatch/core";
import { Agent, request } from "undici";
import {
	assertHostAllowed,
	createSafeLookup,
	type SsrfOptions,
} from "./safe-lookup";
import { getCertExpiry } from "./ssl";

export const USER_AGENT = "LinkWatch/1.0";
/** SRS 5.1: more than 10 redirects → dead link. */
export const MAX_REDIRECTS = 10;
/** NFR-09: read at most 1 MB of the body when searching for the keyword. */
export const MAX_BODY_BYTES = 1024 * 1024;

export type ProbeTarget = {
	url: string;
	method: HttpMethod;
	timeoutS: number;
	keyword?: string;
};
export type ProbeOptions = SsrfOptions & { maxBodyBytes?: number };

class ProbeError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
	}
}

/** Pick the most meaningful error code (ENOTFOUND, ECONNREFUSED, TLS codes…) from an undici/net error. */
function errorCodeOf(err: unknown): string {
	const codes: string[] = [];
	let e = err as { code?: unknown; name?: string; cause?: unknown } | undefined;
	for (let i = 0; i < 5 && e; i++) {
		if (e.name === "TimeoutError" || e.name === "AbortError") return e.name;
		if (typeof e.code === "string") codes.push(e.code);
		e = e.cause as typeof e;
	}
	return codes.find((c) => !c.startsWith("UND_ERR_")) ?? codes[0] ?? "UNKNOWN";
}

async function readUpTo(
	body: AsyncIterable<Buffer> & { destroy(): void },
	max: number,
): Promise<string> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of body) {
		const room = max - size;
		chunks.push(chunk.length > room ? chunk.subarray(0, room) : chunk);
		size += Math.min(chunk.length, room);
		if (size >= max) {
			body.destroy();
			break;
		}
	}
	return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * Send a request to the link and return the raw result (SRS 5.1, FR-17); core's `classify` classifies it.
 * Follows redirects manually (counting hops, SSRF-checking each one), HEAD → GET on 405,
 * and reads the body only when a required keyword is set.
 */
export async function probe(
	target: ProbeTarget,
	opts: ProbeOptions = {},
): Promise<ProbeResult> {
	const timeoutMs = target.timeoutS * 1000;
	const signal = AbortSignal.timeout(timeoutMs);
	const agent = new Agent({
		connect: { lookup: createSafeLookup(opts), timeout: timeoutMs },
	});
	const started = performance.now();
	const elapsed = () => Math.round(performance.now() - started);
	let url = target.url;
	let method: HttpMethod = target.keyword ? "GET" : target.method;
	let redirectCount = 0;
	const sslOf = async (u: string) => {
		const { protocol, hostname, port } = new URL(u);
		if (protocol !== "https:") return undefined;
		return (
			await getCertExpiry(hostname, Number(port || 443), opts)
		)?.toISOString();
	};

	try {
		for (;;) {
			assertHostAllowed(new URL(url).hostname, opts);
			const res = await request(url, {
				method,
				dispatcher: agent,
				signal,
				headersTimeout: timeoutMs,
				bodyTimeout: timeoutMs,
				headers: {
					"user-agent": USER_AGENT,
					accept: "*/*",
					"cache-control": "no-cache",
				},
			});
			const location = res.headers.location;
			if (method === "HEAD" && res.statusCode === 405) {
				await res.body.dump();
				method = "GET";
				continue;
			}
			if (res.statusCode >= 300 && res.statusCode < 400 && location) {
				await res.body.dump();
				redirectCount++;
				if (redirectCount > MAX_REDIRECTS) {
					throw new ProbeError(
						"TOO_MANY_REDIRECTS",
						`More than ${MAX_REDIRECTS} redirects`,
					);
				}
				const next = new URL(String(location), url);
				if (next.protocol !== "http:" && next.protocol !== "https:") {
					throw new ProbeError(
						"UNSUPPORTED_REDIRECT",
						`Redirect to ${next.protocol}`,
					);
				}
				url = next.href;
				if (res.statusCode === 303) method = "GET";
				continue;
			}
			const responseMs = elapsed();
			let keywordFound: boolean | undefined;
			if (target.keyword) {
				const text = await readUpTo(
					res.body,
					opts.maxBodyBytes ?? MAX_BODY_BYTES,
				);
				keywordFound = containsKeyword(text, target.keyword);
			} else {
				await res.body.dump();
			}
			return {
				httpCode: res.statusCode,
				responseMs,
				finalUrl: url,
				redirectCount,
				keywordFound,
				sslExpiresAt: await sslOf(url),
			};
		}
	} catch (err) {
		const code = errorCodeOf(err);
		return {
			responseMs: elapsed(),
			finalUrl: url,
			redirectCount,
			error: {
				code,
				message: String((err as Error)?.message ?? err).slice(0, 300),
			},
			sslExpiresAt:
				code === "BLOCKED_PRIVATE_ADDRESS" ? undefined : await sslOf(url),
		};
	} finally {
		await agent.destroy().catch(() => {});
	}
}
