import { z } from "zod";
import { InvalidUrlError, normalizeUrl } from "../url";
import { HttpMethod } from "./enums";

/** Normalized URL (FR-01, FR-02). Errors carry `params.code` so the UI can translate the message. */
export const NormalizedUrl = z.string().transform((value, ctx) => {
	try {
		return normalizeUrl(value);
	} catch (err) {
		if (!(err instanceof InvalidUrlError)) throw err;
		ctx.addIssue({
			code: "custom",
			message: err.message,
			params: { code: err.code },
		});
		return z.NEVER;
	}
});

const HttpCode = z.number().int().min(100).max(599);

/** Expected HTTP status range, inclusive on both ends. */
export const HttpCodeRange = z
	.object({ from: HttpCode, to: HttpCode })
	.refine((r) => r.from <= r.to, { message: "from must be ≤ to" });
export type HttpCodeRange = z.infer<typeof HttpCodeRange>;

/** Optional string: trimmed, empty → undefined. */
const optionalText = (max: number) =>
	z
		.string()
		.trim()
		.max(max)
		.optional()
		.transform((v) => (v ? v : undefined));

/** FR-01: input when adding/editing a link. */
export const LinkInput = z.object({
	url: NormalizedUrl,
	name: optionalText(200),
	tags: z
		.array(z.string().trim().max(50))
		.max(20)
		.default([])
		.transform((tags) => [...new Set(tags.filter(Boolean))]),
	method: HttpMethod.default("GET"),
	expectedCodes: z
		.array(HttpCodeRange)
		.min(1)
		.max(10)
		.default([{ from: 200, to: 399 }]),
	timeoutS: z.number().int().min(1).max(60).default(30),
	keyword: optionalText(200),
});
export type LinkInput = z.infer<typeof LinkInput>;
/** Shape of the data before parsing (form, CSV). */
export type LinkInputRaw = z.input<typeof LinkInput>;
