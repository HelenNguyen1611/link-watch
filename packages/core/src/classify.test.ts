import { describe, expect, it } from "vitest";
import {
	type ClassifyConfig,
	classify,
	type ProbeResult,
	SLOW_THRESHOLD_MS,
} from "./classify";

const config: ClassifyConfig = { expectedCodes: [{ from: 200, to: 399 }] };

const http = (
	httpCode: number,
	extra: Partial<ProbeResult> = {},
): ProbeResult => ({
	httpCode,
	responseMs: 120,
	finalUrl: "https://abc.com/",
	redirectCount: 0,
	...extra,
});

const netError = (code: string, responseMs = 50): ProbeResult => ({
	responseMs,
	redirectCount: 0,
	error: { code, message: `${code} abc.com` },
});

describe("classify — SRS 5.1 Site down", () => {
	it("5.1 Site down: ENOTFOUND (DNS does not resolve)", () => {
		expect(classify(netError("ENOTFOUND"), config)).toMatchObject({
			result: "down",
			errorType: "dns",
			errorMessage: "ENOTFOUND abc.com",
		});
	});

	it("5.1 Site down: ETIMEDOUT (timeout)", () => {
		expect(classify(netError("ETIMEDOUT", 30_000), config)).toMatchObject({
			result: "down",
			errorType: "timeout",
		});
	});

	it.each([
		"UND_ERR_CONNECT_TIMEOUT",
		"UND_ERR_HEADERS_TIMEOUT",
		"UND_ERR_BODY_TIMEOUT",
		"TimeoutError",
		"AbortError",
	])("5.1 Site down: undici/AbortSignal timeout %s", (code) => {
		expect(classify(netError(code), config)).toMatchObject({
			result: "down",
			errorType: "timeout",
		});
	});

	it("5.1 Site down: ECONNREFUSED (connection refused)", () => {
		expect(classify(netError("ECONNREFUSED"), config)).toMatchObject({
			result: "down",
			errorType: "connection_refused",
		});
	});

	it.each([
		"CERT_HAS_EXPIRED",
		"DEPTH_ZERO_SELF_SIGNED_CERT",
		"ERR_TLS_CERT_ALTNAME_INVALID",
		"UNABLE_TO_VERIFY_LEAF_SIGNATURE",
		"SELF_SIGNED_CERT_IN_CHAIN",
		"ERR_SSL_WRONG_VERSION_NUMBER",
	])("5.1 Site down: SSL error %s", (code) => {
		expect(classify(netError(code), config)).toMatchObject({
			result: "down",
			errorType: "ssl",
		});
	});

	it.each([
		"ECONNRESET",
		"EHOSTUNREACH",
		"ENETUNREACH",
		"UND_ERR_SOCKET",
		"SOMETHING_ODD",
	])("5.1 Site down: other network error %s", (code) => {
		expect(classify(netError(code), config)).toMatchObject({
			result: "down",
			errorType: "network",
		});
	});

	it.each([502, 503, 500, 504])("5.1 Site down: status %d", (code) => {
		expect(classify(http(code), config)).toMatchObject({
			result: "down",
			errorType: "http_5xx",
			httpCode: code,
		});
	});
});

describe("classify — SRS 5.1 Dead link", () => {
	it.each([404, 410, 403, 400, 401, 429])(
		"5.1 Dead link: status %d",
		(code) => {
			expect(classify(http(code), config)).toMatchObject({
				result: "dead",
				errorType: "http_4xx",
				httpCode: code,
			});
		},
	);

	it("5.1 Dead link: status outside the expected list", () => {
		const onlyOk: ClassifyConfig = { expectedCodes: [{ from: 200, to: 200 }] };
		expect(classify(http(204), onlyOk)).toMatchObject({
			result: "dead",
			errorType: "unexpected_status",
		});
	});

	it("5.1 Dead link: more than 10 redirects", () => {
		expect(
			classify(
				{
					responseMs: 900,
					redirectCount: 11,
					error: {
						code: "TOO_MANY_REDIRECTS",
						message: "more than 10 redirects",
					},
				},
				config,
			),
		).toMatchObject({ result: "dead", errorType: "too_many_redirects" });
	});

	it("5.1 Dead link: required keyword missing", () => {
		expect(
			classify(http(200, { keywordFound: false }), {
				...config,
				keyword: "Liên hệ",
			}),
		).toMatchObject({
			result: "dead",
			errorType: "keyword_missing",
			httpCode: 200,
		});
	});

	it("NFR-07: URL pointing at a private address is blocked → dead link (not site down)", () => {
		expect(
			classify(
				{
					responseMs: 3,
					redirectCount: 0,
					error: { code: "BLOCKED_PRIVATE_ADDRESS", message: "10.0.0.5" },
				},
				config,
			),
		).toMatchObject({ result: "dead", errorType: "blocked_private_address" });
	});
});

describe("classify — SRS 5.1 Slow and Up", () => {
	it("5.1 Slow: 200 in 7.2 seconds", () => {
		expect(classify(http(200, { responseMs: 7200 }), config)).toMatchObject({
			result: "slow",
			httpCode: 200,
			responseMs: 7200,
		});
	});

	it("5.1 Slow: default threshold 5,000 ms, exactly 5,000 ms is still Up", () => {
		expect(SLOW_THRESHOLD_MS).toBe(5000);
		expect(classify(http(200, { responseMs: 5000 }), config).result).toBe("up");
		expect(classify(http(200, { responseMs: 5001 }), config).result).toBe(
			"slow",
		);
	});

	it("5.1 Slow: threshold is configurable", () => {
		expect(
			classify(http(200, { responseMs: 1500 }), {
				...config,
				slowThresholdMs: 1000,
			}).result,
		).toBe("slow");
	});

	it("5.1 Up: 200", () => {
		const r = classify(http(200), config);
		expect(r).toEqual({
			result: "up",
			httpCode: 200,
			responseMs: 120,
			finalUrl: "https://abc.com/",
		});
	});

	it("5.1 Up: 301 → 200 (redirect followed)", () => {
		expect(
			classify(
				http(200, { redirectCount: 1, finalUrl: "https://www.abc.com/" }),
				config,
			),
		).toMatchObject({ result: "up", finalUrl: "https://www.abc.com/" });
	});

	it("5.1 Up: required keyword present", () => {
		expect(
			classify(http(200, { keywordFound: true }), {
				...config,
				keyword: "Liên hệ",
			}).result,
		).toBe("up");
	});

	it("5.1 Up: expected status codes take precedence, including user-declared 4xx/5xx", () => {
		const expect503: ClassifyConfig = {
			expectedCodes: [{ from: 503, to: 503 }],
		};
		expect(classify(http(503), expect503).result).toBe("up");
		const expect404: ClassifyConfig = {
			expectedCodes: [{ from: 404, to: 404 }],
		};
		expect(classify(http(404), expect404).result).toBe("up");
	});

	it("FR-17: keeps the SSL certificate expiry in the result", () => {
		expect(
			classify(http(200, { sslExpiresAt: "2027-01-01T00:00:00.000Z" }), config),
		).toMatchObject({ sslExpiresAt: "2027-01-01T00:00:00.000Z" });
	});
});

describe("classify — step 4b: ignore WAF 403 per domain (SRS 3.4)", () => {
	const waf: ClassifyConfig = { ...config, ignoreWaf403: true };

	it("5.1 + 4b: without the flag a 403 is a dead link", () => {
		expect(classify(http(403), config)).toMatchObject({
			result: "dead",
			errorType: "http_4xx",
		});
	});

	it("4b: with the flag a 403 counts as reachable (Up), code kept, reason noted", () => {
		expect(classify(http(403), waf)).toMatchObject({
			result: "up",
			httpCode: 403,
			errorMessage: "HTTP 403 ignored (domain WAF setting)",
		});
		expect(classify(http(403), waf).errorType).toBeUndefined();
	});

	it("4b: a slow 403 is Slow; the keyword is not required on the WAF page", () => {
		expect(classify(http(403, { responseMs: 7200 }), waf).result).toBe("slow");
		expect(
			classify(http(403, { keywordFound: false }), { ...waf, keyword: "Buy" })
				.result,
		).toBe("up");
	});

	it("4b: only 403 — 404, 401 and 5xx keep their meaning", () => {
		expect(classify(http(404), waf).result).toBe("dead");
		expect(classify(http(401), waf).result).toBe("dead");
		expect(classify(http(503), waf).result).toBe("down");
	});
});
