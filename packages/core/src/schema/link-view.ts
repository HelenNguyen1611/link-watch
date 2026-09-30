import { z } from "zod";
import { CheckErrorType, HttpMethod, LinkStatus } from "./enums";
import { HttpCodeRange } from "./link";

/** Link as returned to the web (type shared by API ↔ web). */
export const LinkView = z.object({
	id: z.string(),
	domain: z.string(),
	url: z.string(),
	name: z.string().optional(),
	tags: z.array(z.string()),
	method: HttpMethod,
	expectedCodes: z.array(HttpCodeRange),
	timeoutS: z.number(),
	keyword: z.string().optional(),
	/** FR-13: own schedule template; absent → inherits from the domain / default. */
	scheduleId: z.string().optional(),
	status: LinkStatus,
	paused: z.boolean(),
	nextRunAt: z.string().optional(),
	lastCheckedAt: z.string().optional(),
	lastHttpCode: z.number().optional(),
	lastResponseMs: z.number().optional(),
	lastErrorType: CheckErrorType.optional(),
	createdAt: z.string(),
});
export type LinkView = z.infer<typeof LinkView>;

export type LinkPage = { items: LinkView[]; cursor: string | null };

const KEYS = Object.keys(LinkView.shape) as (keyof LinkView)[];

/** Drops internal fields (deletedAt, updatedAt, …) before returning to the web. */
export function toLinkView(
	link: Partial<Record<keyof LinkView | string, unknown>>,
): LinkView {
	const out: Record<string, unknown> = {};
	for (const k of KEYS) if (link[k] !== undefined) out[k] = link[k];
	return out as LinkView;
}
