import { createHash } from "node:crypto";
import { SendMessageBatchCommand, type SQSClient } from "@aws-sdk/client-sqs";
import { type CheckJob, MAX_LINKS_PER_JOB } from "@linkwatch/core";
import type { Db } from "@linkwatch/core/db";
import pLimit from "p-limit";

/**
 * Move next_run_at forward once a job is sent (a "lease") so the next tick does not resend it.
 * The Checker writes the real next run when done; if the job ends in the DLQ, the link is resent when the lease expires (NFR-04).
 */
export const LEASE_MS = 30 * 60_000;
/** SQS: at most 10 messages per SendMessageBatch. */
const SQS_BATCH = 10;
/** Number of parallel DynamoDB writes while leasing. */
const WRITE_CONCURRENCY = 10;

export type DispatcherDeps = {
	db: Db;
	sqs: SQSClient;
	queueUrl: string;
	now?: () => Date;
	log?: (message: string, extra?: Record<string, unknown>) => void;
};

type DueLink = { domain: string; id: string; nextRunAt: string };

const chunk = <T>(items: T[], size: number): T[][] =>
	Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
		items.slice(i * size, (i + 1) * size),
	);

const isConditionalFailure = (err: unknown) =>
	/ConditionalCheckFailed|conditional request failed/i.test(String(err));

/** EventBridge Scheduler every 5 minutes → fetch due links (GSI1) → SQS FIFO. */
export function createHandler(deps: DispatcherDeps) {
	const now = deps.now ?? (() => new Date());
	const log = deps.log ?? (() => {});
	const limit = pLimit(WRITE_CONCURRENCY);

	/** Lease only if next_run_at is unchanged; returns false if the Checker or a user just updated the link. */
	const lease = (l: DueLink, until: string) =>
		limit(async () => {
			try {
				await deps.db.Link.patch({ domain: l.domain, id: l.id })
					.set({ nextRunAt: until })
					.where(({ nextRunAt }, { eq }) => eq(nextRunAt, l.nextRunAt))
					.go();
				return true;
			} catch (err) {
				if (isConditionalFailure(err)) return false;
				throw err;
			}
		});

	const release = (l: DueLink, leasedUntil: string) =>
		limit(async () => {
			await deps.db.Link.patch({ domain: l.domain, id: l.id })
				.set({ nextRunAt: l.nextRunAt })
				.where(({ nextRunAt }, { eq }) => eq(nextRunAt, leasedUntil))
				.go()
				.catch((err) => {
					if (!isConditionalFailure(err)) throw err;
				});
		});

	return async function handler() {
		const tick = now();
		const dispatchedAt = tick.toISOString();
		const leasedUntil = new Date(tick.getTime() + LEASE_MS).toISOString();

		const { data } = await deps.db.Link.query
			.due({})
			.lte({ nextRunAt: dispatchedAt })
			.go({ pages: "all" });
		const due: DueLink[] = data
			.filter((l) => l.nextRunAt && !l.paused && !l.deletedAt)
			.map((l) => ({
				domain: l.domain,
				id: l.id,
				nextRunAt: l.nextRunAt as string,
			}));

		const leased = (
			await Promise.all(
				due.map(async (l) => ((await lease(l, leasedUntil)) ? l : null)),
			)
		).filter((l): l is DueLink => l !== null);

		const byDomain = new Map<string, DueLink[]>();
		for (const l of leased)
			byDomain.set(l.domain, [...(byDomain.get(l.domain) ?? []), l]);
		const jobs = [...byDomain.entries()].flatMap(([domain, links]) =>
			chunk(links, MAX_LINKS_PER_JOB).map((part) => ({
				job: {
					kind: "scheduled",
					domain,
					linkIds: part.map((l) => l.id),
					dispatchedAt,
				} satisfies CheckJob,
				links: part,
			})),
		);

		let dispatched = 0;
		let failed = 0;
		for (const batch of chunk(jobs, SQS_BATCH)) {
			const entries = batch.map(({ job }, i) => ({
				Id: String(i),
				MessageBody: JSON.stringify(job),
				MessageGroupId: job.domain,
				MessageDeduplicationId: createHash("sha256")
					.update(`${dispatchedAt}|${job.linkIds.join(",")}`)
					.digest("hex"),
			}));
			let failedIds: Set<string>;
			try {
				const res = await deps.sqs.send(
					new SendMessageBatchCommand({
						QueueUrl: deps.queueUrl,
						Entries: entries,
					}),
				);
				failedIds = new Set((res.Failed ?? []).map((f) => f.Id ?? ""));
			} catch (err) {
				log("SQS send failed", { error: String(err) });
				failedIds = new Set(entries.map((e) => e.Id));
			}
			for (const [i, { links }] of batch.entries()) {
				if (failedIds.has(String(i))) {
					failed += links.length;
					await Promise.all(links.map((l) => release(l, leasedUntil)));
				} else {
					dispatched += links.length;
				}
			}
		}

		const summary = {
			due: due.length,
			dispatched,
			failed,
			messages: jobs.length,
		};
		log("Dispatch finished", summary);
		return summary;
	};
}
