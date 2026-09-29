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
	it("5.1 Site down: ENOTFOUND (DNS không phân giải)", () => {
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
	])("5.1 Site down: timeout của undici/AbortSignal %s", (code) => {
		expect(classify(netError(code), config)).toMatchObject({
			result: "down",
			errorType: "timeout",
		});
	});

	it("5.1 Site down: ECONNREFUSED (từ chối kết nối)", () => {
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
	])("5.1 Site down: lỗi SSL %s", (code) => {
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
		"LẠ",
	])("5.1 Site down: lỗi mạng khác %s", (code) => {
		expect(classify(netError(code), config)).toMatchObject({
			result: "down",
			errorType: "network",
		});
	});

	it.each([502, 503, 500, 504])("5.1 Site down: mã %d", (code) => {
		expect(classify(http(code), config)).toMatchObject({
			result: "down",
			errorType: "http_5xx",
			httpCode: code,
		});
	});
});

describe("classify — SRS 5.1 Link chết", () => {
	it.each([404, 410, 403, 400, 401, 429])("5.1 Link chết: mã %d", (code) => {
		expect(classify(http(code), config)).toMatchObject({
			result: "dead",
			errorType: "http_4xx",
			httpCode: code,
		});
	});

	it("5.1 Link chết: mã ngoài danh sách mong đợi", () => {
		const onlyOk: ClassifyConfig = { expectedCodes: [{ from: 200, to: 200 }] };
		expect(classify(http(204), onlyOk)).toMatchObject({
			result: "dead",
			errorType: "unexpected_status",
		});
	});

	it("5.1 Link chết: vượt 10 lần redirect", () => {
		expect(
			classify(
				{
					responseMs: 900,
					redirectCount: 11,
					error: { code: "TOO_MANY_REDIRECTS", message: "vượt 10 redirect" },
				},
				config,
			),
		).toMatchObject({ result: "dead", errorType: "too_many_redirects" });
	});

	it("5.1 Link chết: thiếu từ khóa bắt buộc", () => {
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

	it("NFR-07: URL trỏ vào địa chỉ nội bộ bị chặn → Link chết (không phải site down)", () => {
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

describe("classify — SRS 5.1 Chậm và Hoạt động", () => {
	it("5.1 Chậm: 200 trong 7,2 giây", () => {
		expect(classify(http(200, { responseMs: 7200 }), config)).toMatchObject({
			result: "slow",
			httpCode: 200,
			responseMs: 7200,
		});
	});

	it("5.1 Chậm: ngưỡng mặc định 5.000 ms, đúng 5.000 ms vẫn là Hoạt động", () => {
		expect(SLOW_THRESHOLD_MS).toBe(5000);
		expect(classify(http(200, { responseMs: 5000 }), config).result).toBe("up");
		expect(classify(http(200, { responseMs: 5001 }), config).result).toBe(
			"slow",
		);
	});

	it("5.1 Chậm: ngưỡng cấu hình được", () => {
		expect(
			classify(http(200, { responseMs: 1500 }), {
				...config,
				slowThresholdMs: 1000,
			}).result,
		).toBe("slow");
	});

	it("5.1 Hoạt động: 200", () => {
		const r = classify(http(200), config);
		expect(r).toEqual({
			result: "up",
			httpCode: 200,
			responseMs: 120,
			finalUrl: "https://abc.com/",
		});
	});

	it("5.1 Hoạt động: 301 → 200 (đã theo redirect)", () => {
		expect(
			classify(
				http(200, { redirectCount: 1, finalUrl: "https://www.abc.com/" }),
				config,
			),
		).toMatchObject({ result: "up", finalUrl: "https://www.abc.com/" });
	});

	it("5.1 Hoạt động: có từ khóa bắt buộc", () => {
		expect(
			classify(http(200, { keywordFound: true }), {
				...config,
				keyword: "Liên hệ",
			}).result,
		).toBe("up");
	});

	it("5.1 Hoạt động: mã nằm trong danh sách mong đợi được ưu tiên, kể cả 4xx/5xx do người dùng khai báo", () => {
		const expect503: ClassifyConfig = {
			expectedCodes: [{ from: 503, to: 503 }],
		};
		expect(classify(http(503), expect503).result).toBe("up");
		const expect404: ClassifyConfig = {
			expectedCodes: [{ from: 404, to: 404 }],
		};
		expect(classify(http(404), expect404).result).toBe("up");
	});

	it("FR-17: giữ hạn chứng chỉ SSL trong kết quả", () => {
		expect(
			classify(http(200, { sslExpiresAt: "2027-01-01T00:00:00.000Z" }), config),
		).toMatchObject({ sslExpiresAt: "2027-01-01T00:00:00.000Z" });
	});
});
