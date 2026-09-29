/** FR-01: độ dài tối đa của URL, tính sau khi chuẩn hóa. */
export const MAX_URL_LENGTH = 2048;

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

export type InvalidUrlCode = "invalid_url" | "unsupported_scheme" | "too_long";

export class InvalidUrlError extends Error {
	constructor(
		readonly code: InvalidUrlCode,
		readonly input: string,
	) {
		super(`URL không hợp lệ (${code}): ${input.slice(0, 100)}`);
		this.name = "InvalidUrlError";
	}
}

/**
 * FR-02: chuẩn hóa URL trước khi lưu; kết quả dùng luôn làm khóa chống trùng.
 * Bỏ khoảng trắng đầu/cuối, hạ chữ thường scheme + host (IDN → punycode),
 * bỏ cổng mặc định và `#fragment`; path và query giữ nguyên.
 */
export function normalizeUrl(input: string): string {
	const trimmed = input.trim();
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		throw new InvalidUrlError("invalid_url", input);
	}
	if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
		throw new InvalidUrlError("unsupported_scheme", input);
	}
	if (!url.hostname) {
		throw new InvalidUrlError("invalid_url", input);
	}
	url.hash = "";
	const normalized = url.href;
	if (normalized.length > MAX_URL_LENGTH) {
		throw new InvalidUrlError("too_long", input);
	}
	return normalized;
}
