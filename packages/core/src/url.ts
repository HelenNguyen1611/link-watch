/** FR-01: maximum URL length, measured after normalization. */
export const MAX_URL_LENGTH = 2048;

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

export type InvalidUrlCode = "invalid_url" | "unsupported_scheme" | "too_long";

export class InvalidUrlError extends Error {
	constructor(
		readonly code: InvalidUrlCode,
		readonly input: string,
	) {
		super(`Invalid URL (${code}): ${input.slice(0, 100)}`);
		this.name = "InvalidUrlError";
	}
}

/**
 * FR-02: normalizes a URL before storing; the result doubles as the dedupe key.
 * Trims whitespace, lowercases scheme + host (IDN → punycode),
 * drops the default port and `#fragment`; path and query are kept as is.
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
