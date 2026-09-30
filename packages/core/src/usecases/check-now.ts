import { type CheckNowPlan, planCheckNow } from "../check-now";
import type { Db } from "../db/index";
import type { PriorityJob } from "../queue";
import { CheckNowInput, type CheckNowResult } from "../schema/incident-view";

/**
 * Sends one job to the priority queue (the API wires SQS; tests use a fake).
 * `delaySeconds` (≤ 900) postpones delivery — FR-37 verification attempts.
 */
export type SendPriorityJob = (
	job: PriorityJob,
	delaySeconds?: number,
) => Promise<void>;

async function candidates(db: Db, input: CheckNowInput) {
	if (input.domain) {
		const { data } = await db.Link.query
			.primary({ domain: input.domain })
			.go({ pages: "all" });
		return {
			requested: data.filter((l) => !l.deletedAt).map((l) => l.id),
			found: data,
		};
	}
	const ids = [...new Set(input.linkIds ?? [])];
	const found = (
		await Promise.all(ids.map((id) => db.Link.query.byId({ id }).go()))
	).flatMap((r) => r.data);
	return { requested: ids, found };
}

/**
 * FR-16: "Check now" for chosen links or a whole domain — queues check_now jobs on the
 * priority queue (no delay), so results arrive within seconds instead of the next tick.
 */
export async function checkNow(
	db: Db,
	raw: unknown,
	{ send, now = new Date() }: { send: SendPriorityJob; now?: Date },
): Promise<CheckNowResult> {
	const input = CheckNowInput.parse(raw);
	const { requested, found } = await candidates(db, input);
	const plan: CheckNowPlan = planCheckNow(requested, found, now);
	for (const job of plan.jobs) await send(job);
	return { queued: plan.queued, skipped: plan.skipped, jobs: plan.jobs.length };
}
