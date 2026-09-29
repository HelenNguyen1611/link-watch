import { z } from "zod";

/** The Checker checks at most 20 links per message (SRS 3.4). */
export const MAX_LINKS_PER_JOB = 20;
/** SQS: the longest per-message delay a Standard queue accepts. */
export const MAX_DELAY_SECONDS = 900;
/**
 * PLAN Q2: when a delayed recheck is queued, `next_run_at` is stored this much later than
 * the recheck itself, so the Dispatcher only picks the link up if the message is lost.
 */
export const RECHECK_FALLBACK_MS = 5 * 60_000;

const linkIds = z.array(z.string().min(1)).min(1).max(MAX_LINKS_PER_JOB);

/**
 * Dispatcher → Checker over the FIFO queue. A message only holds links of one domain
 * (`MessageGroupId = domain`, FR-14).
 */
export const ScheduledJob = z.object({
	kind: z.literal("scheduled"),
	domain: z.string().min(1),
	linkIds,
	dispatchedAt: z.iso.datetime(),
});

/**
 * PLAN Q2: jobs on the priority Standard queue, with a per-message `DelaySeconds`.
 * - recheck: SRS 5.2 steps 1 and 3 (2 minutes after the first failure, 10 minutes while an incident is open).
 * - check_now: FR-16 (step 21).
 * - verify: FR-36/FR-37 "Fixed — check again" (now, +2 and +5 minutes; milestone 3).
 */
export const PriorityJob = z.object({
	kind: z.enum(["recheck", "check_now", "verify"]),
	domain: z.string().min(1),
	linkIds,
	/** ISO time the job is meant to run (enqueue time + delay). */
	dueAt: z.iso.datetime(),
	/** FR-37: verification attempt (1–3); only for `verify`. */
	attempt: z.number().int().min(1).max(3).optional(),
});

export const CheckJob = z.discriminatedUnion("kind", [
	ScheduledJob,
	PriorityJob.extend({ kind: z.literal("recheck") }),
	PriorityJob.extend({ kind: z.literal("check_now") }),
	PriorityJob.extend({ kind: z.literal("verify") }),
]);
export type ScheduledJob = z.infer<typeof ScheduledJob>;
export type PriorityJob = z.infer<typeof PriorityJob>;
export type CheckJob = z.infer<typeof CheckJob>;

export type NextRunPlan = {
	/** Value written to the link's `next_run_at`. */
	storedNextRunAt: Date;
	/** Set when the next run is close enough for a delayed priority message. */
	delaySeconds?: number;
};

/**
 * PLAN Q2: next runs within 15 minutes (5.2 rechecks) go to the priority queue with a delay,
 * and `next_run_at` becomes a fallback 5 minutes later; farther runs are left to the Dispatcher.
 */
export function planNextRun(nextRunAt: Date, now: Date): NextRunPlan {
	const delayMs = nextRunAt.getTime() - now.getTime();
	if (delayMs > MAX_DELAY_SECONDS * 1000) return { storedNextRunAt: nextRunAt };
	return {
		storedNextRunAt: new Date(nextRunAt.getTime() + RECHECK_FALLBACK_MS),
		delaySeconds: Math.max(0, Math.ceil(delayMs / 1000)),
	};
}
