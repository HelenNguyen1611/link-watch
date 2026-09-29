import { z } from "zod";

/** Checker check tối đa 20 link mỗi message (SRS 3.4). */
export const MAX_LINKS_PER_JOB = 20;

/**
 * Message SQS từ Dispatcher → Checker. Một message chỉ chứa link của một domain
 * (`MessageGroupId = domain`, FR-14). Loại ưu tiên (recheck, xác minh, Check now) thêm ở Bước 14.
 */
export const CheckJob = z.object({
	kind: z.literal("scheduled"),
	domain: z.string().min(1),
	linkIds: z.array(z.string().min(1)).min(1).max(MAX_LINKS_PER_JOB),
	dispatchedAt: z.iso.datetime(),
});
export type CheckJob = z.infer<typeof CheckJob>;
