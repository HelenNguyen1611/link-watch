import type { CheckErrorType, CheckResultKind } from "./schema/enums";
import type { HttpCodeRange } from "./schema/link";

/** SRS 5.1: ngưỡng Chậm mặc định. */
export const SLOW_THRESHOLD_MS = 5000;

/** Kết quả thô từ Checker (Bước 11), chưa phân loại. */
export type ProbeResult = {
	httpCode?: number;
	responseMs: number;
	finalUrl?: string;
	redirectCount: number;
	/** undefined khi link không có từ khóa bắt buộc. */
	keywordFound?: boolean;
	sslExpiresAt?: string;
	/** Có khi không nhận được phản hồi HTTP dùng được. */
	error?: { code: string; message: string };
};

export type ClassifyConfig = {
	expectedCodes: HttpCodeRange[];
	keyword?: string;
	slowThresholdMs?: number;
};

export type ClassifiedCheck = {
	result: CheckResultKind;
	httpCode?: number;
	responseMs: number;
	finalUrl?: string;
	errorType?: CheckErrorType;
	errorMessage?: string;
	sslExpiresAt?: string;
};

const TIMEOUT_CODES = new Set([
	"ETIMEDOUT",
	"UND_ERR_CONNECT_TIMEOUT",
	"UND_ERR_HEADERS_TIMEOUT",
	"UND_ERR_BODY_TIMEOUT",
	"TimeoutError",
	"AbortError",
]);
const SSL_CODE =
	/^(CERT_|ERR_TLS_|ERR_SSL_|DEPTH_ZERO_SELF_SIGNED_CERT$|SELF_SIGNED_CERT_IN_CHAIN$|UNABLE_TO_(VERIFY|GET)_)/;

/** Lỗi không có phản hồi HTTP → loại lỗi và kết quả theo SRS 5.1. */
function errorTypeOf(code: string): {
	result: CheckResultKind;
	errorType: CheckErrorType;
} {
	if (code === "TOO_MANY_REDIRECTS")
		return { result: "dead", errorType: "too_many_redirects" };
	if (code === "BLOCKED_PRIVATE_ADDRESS")
		return { result: "dead", errorType: "blocked_private_address" };
	if (code === "ENOTFOUND" || code === "EAI_AGAIN")
		return { result: "down", errorType: "dns" };
	if (code === "ECONNREFUSED")
		return { result: "down", errorType: "connection_refused" };
	if (TIMEOUT_CODES.has(code)) return { result: "down", errorType: "timeout" };
	if (SSL_CODE.test(code)) return { result: "down", errorType: "ssl" };
	return { result: "down", errorType: "network" };
}

const isExpected = (code: number, ranges: HttpCodeRange[]) =>
	ranges.some((r) => code >= r.from && code <= r.to);

/**
 * SRS 5.1: phân loại một lần check thành Hoạt động / Chậm / Link chết / Site down.
 * Mã trong danh sách mong đợi luôn được ưu tiên (người dùng khai báo rõ, vd. chờ 503 khi bảo trì).
 */
export function classify(
	probe: ProbeResult,
	config: ClassifyConfig,
): ClassifiedCheck {
	const base = {
		httpCode: probe.httpCode,
		responseMs: probe.responseMs,
		finalUrl: probe.finalUrl,
		sslExpiresAt: probe.sslExpiresAt,
	};
	if (probe.error || probe.httpCode === undefined) {
		const error = probe.error ?? {
			code: "NO_RESPONSE",
			message: "Không có phản hồi",
		};
		return { ...base, ...errorTypeOf(error.code), errorMessage: error.message };
	}
	const code = probe.httpCode;
	if (!isExpected(code, config.expectedCodes)) {
		const errorType: CheckErrorType =
			code >= 500 ? "http_5xx" : code >= 400 ? "http_4xx" : "unexpected_status";
		return {
			...base,
			result: code >= 500 ? "down" : "dead",
			errorType,
			errorMessage: `HTTP ${code}`,
		};
	}
	if (config.keyword && probe.keywordFound === false) {
		return {
			...base,
			result: "dead",
			errorType: "keyword_missing",
			errorMessage: `Thiếu từ khóa "${config.keyword}"`,
		};
	}
	const slow = probe.responseMs > (config.slowThresholdMs ?? SLOW_THRESHOLD_MS);
	return { ...base, result: slow ? "slow" : "up" };
}
