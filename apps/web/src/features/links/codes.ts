import type { HttpCodeRange } from "@linkwatch/core";

/** [{200,399},{404,404}] → "200-399, 404" */
export const formatCodes = (ranges: readonly HttpCodeRange[]) =>
	ranges
		.map((r) => (r.from === r.to ? `${r.from}` : `${r.from}-${r.to}`))
		.join(", ");

/**
 * "200-399, 404" → ranges; `null` when the text is not a list of codes / ranges.
 * Range limits and order are checked by the shared `LinkInput` schema.
 */
export function parseCodes(text: string): HttpCodeRange[] | null {
	const parts = text.split(/[,;\s]+/).filter(Boolean);
	if (parts.length === 0) return null;
	const ranges: HttpCodeRange[] = [];
	for (const part of parts) {
		const m = /^(\d{3})(?:-(\d{3}))?$/.exec(part);
		if (!m) return null;
		ranges.push({ from: Number(m[1]), to: Number(m[2] ?? m[1]) });
	}
	return ranges;
}
