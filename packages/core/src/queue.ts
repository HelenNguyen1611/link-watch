import { z } from "zod";

/** The Checker checks at most 20 links per message (SRS 3.4). */
export const MAX_LINKS_PER_JOB = 20;

/**
 * SQS message from Dispatcher → Checker. A message only holds links of one domain
 * (`MessageGroupId = domain`, FR-14). Priority kinds (recheck, verification, Check now) are added in step 14.
 */
export const CheckJob = z.object({
	kind: z.literal("scheduled"),
	domain: z.string().min(1),
	linkIds: z.array(z.string().min(1)).min(1).max(MAX_LINKS_PER_JOB),
	dispatchedAt: z.iso.datetime(),
});
export type CheckJob = z.infer<typeof CheckJob>;
