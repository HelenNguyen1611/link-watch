import { MAX_LINKS_PER_JOB, type PriorityJob } from "./queue";

export type CheckNowCandidate = {
	id: string;
	domain: string;
	paused?: boolean;
	deletedAt?: string;
};

export type CheckNowPlan = {
	jobs: PriorityJob[];
	queued: string[];
	skipped: { id: string; reason: "paused" | "not_found" }[];
};

/**
 * FR-16: turns the chosen links into priority-queue jobs — one domain per job (FR-14,
 * NFR-09: the Checker keeps ≤ 2 requests per domain) and at most 20 links per job.
 * Paused (FR-04), deleted or unknown links are skipped.
 */
export function planCheckNow(
	requested: readonly string[],
	found: readonly CheckNowCandidate[],
	now: Date,
): CheckNowPlan {
	const byId = new Map(found.map((l) => [l.id, l]));
	const skipped: CheckNowPlan["skipped"] = [];
	const byDomain = new Map<string, string[]>();
	for (const id of new Set(requested)) {
		const link = byId.get(id);
		if (!link || link.deletedAt) skipped.push({ id, reason: "not_found" });
		else if (link.paused) skipped.push({ id, reason: "paused" });
		else byDomain.set(link.domain, [...(byDomain.get(link.domain) ?? []), id]);
	}
	const dueAt = now.toISOString();
	const jobs: PriorityJob[] = [];
	for (const [domain, ids] of byDomain)
		for (let i = 0; i < ids.length; i += MAX_LINKS_PER_JOB)
			jobs.push({
				kind: "check_now",
				domain,
				linkIds: ids.slice(i, i + MAX_LINKS_PER_JOB),
				dueAt,
			});
	return { jobs, queued: [...byDomain.values()].flat(), skipped };
}
