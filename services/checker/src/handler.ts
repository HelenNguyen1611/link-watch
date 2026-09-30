import {
	CheckJob,
	classify,
	nextRunAt,
	type ProbeResult,
	resolveEffectiveSchedule,
	type Schedule,
} from "@linkwatch/core";
import type { Db } from "@linkwatch/core/db";
import {
	addTickFailure,
	applyVerification,
	loadScheduleTemplates,
	recordCheck,
} from "@linkwatch/core/usecases";
import type {
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
	SQSRecord,
} from "aws-lambda";
import pLimit, { type LimitFunction } from "p-limit";
import { enqueuePriority, type PriorityQueue } from "./enqueue";
import {
	type ProbeOptions,
	type ProbeTarget,
	probe as realProbe,
} from "./probe";

/** Records without a source ARN (tests) are treated as FIFO. */
const isFifo = (record: SQSRecord) =>
	!record.eventSourceARN || record.eventSourceARN.endsWith(".fifo");

/** FR-14 / NFR-09: at most 2 concurrent requests per domain. */
export const PER_DOMAIN_CONCURRENCY = 2;

export type CheckerDeps = {
	db: Db;
	now?: () => Date;
	probe?: (target: ProbeTarget, opts: ProbeOptions) => Promise<ProbeResult>;
	probeOptions?: ProbeOptions;
	/** PLAN Q2: delayed rechecks; without it the Dispatcher picks the link up via next_run_at. */
	priorityQueue?: PriorityQueue;
	log?: (message: string, extra?: Record<string, unknown>) => void;
};

/**
 * SQS (FIFO, MessageGroupId = domain) → check each link → store the result and
 * apply the incident confirmation state machine (SRS 5.2) through `recordCheck`.
 */
export function createHandler(deps: CheckerDeps) {
	const now = deps.now ?? (() => new Date());
	const probe = deps.probe ?? realProbe;
	const log = deps.log ?? (() => {});

	async function checkLink(
		domainName: string,
		id: string,
		jobId: string,
		/** dispatchedAt of a scheduled job (5.2 step 5 run), undefined for priority jobs. */
		tick: string | undefined,
		domain: {
			ignoreWaf403?: boolean;
			scheduleId?: string;
			enabled?: boolean;
		} | null,
		/** FR-12 / FR-13: schedule templates of this invocation. */
		templates: ReadonlyMap<string, Schedule>,
		/** FR-37: this check verifies a "fixed" claim. */
		verify?: { incidentId: string; claimedAt: string; attempt: number },
	): Promise<void> {
		const { data: link } = await deps.db.Link.get({
			domain: domainName,
			id,
		}).go();
		if (!link || link.deletedAt || link.paused) {
			log("Skipping link", {
				domain: domainName,
				id,
				reason: link ? "paused/deleted" : "not_found",
			});
			return;
		}
		// SQS redelivery of a job already recorded: no second request to the site.
		if (link.lastJobId === jobId) {
			log("Skipping link", {
				domain: domainName,
				id,
				reason: "duplicate_job",
			});
			return;
		}
		// FR-08: a disabled domain is not checked; only its next run moves on.
		if (domain?.enabled === false) {
			const rule = resolveEffectiveSchedule(link, domain, templates).rule;
			await deps.db.Link.patch({ domain: domainName, id })
				.set({ nextRunAt: nextRunAt(rule, id, now()).toISOString() })
				.go();
			log("Skipping link", {
				domain: domainName,
				id,
				reason: "domain_disabled",
			});
			return;
		}
		const raw = await probe(
			{
				url: link.url,
				method: link.method,
				timeoutS: link.timeoutS,
				keyword: link.keyword,
			},
			deps.probeOptions ?? {},
		);
		const checked = classify(raw, {
			expectedCodes: link.expectedCodes,
			keyword: link.keyword,
			// Step 4b: domain setting — a 403 from a WAF is not a dead link.
			ignoreWaf403: domain?.ignoreWaf403 ?? false,
		});
		// FR-13: Link > Domain > Default decides the next scheduled run.
		const schedule = resolveEffectiveSchedule(
			link,
			domain ?? undefined,
			templates,
		).rule;
		// FR-37: a successful verification closes the incident "fixed by" the claimer.
		const claim = verify
			? (
					await deps.db.Claim.get({
						incidentId: verify.incidentId,
						claimedAt: verify.claimedAt,
					}).go()
				).data
			: null;
		const outcome = await recordCheck(deps.db, link, checked, {
			now: now(),
			jobId,
			schedule,
			...(claim?.outcome === "pending" && { verifiedBy: claim.byEmail }),
		});
		if (verify && outcome.kind === "recorded") {
			const effect = await applyVerification(deps.db, verify, checked, now());
			log("Verification", {
				domain: domainName,
				id,
				attempt: verify.attempt,
				effect,
			});
		}
		if (outcome.kind === "skipped") {
			log("Check not recorded", {
				domain: domainName,
				id,
				reason: outcome.reason,
			});
			return;
		}
		if (tick && (checked.result === "dead" || checked.result === "down"))
			await addTickFailure(deps.db, tick);
		if (outcome.evaluation.action.kind !== "none")
			log("Incident action", {
				domain: domainName,
				id,
				action: outcome.evaluation.action.kind,
			});
		if (outcome.recheck && deps.priorityQueue) {
			try {
				await enqueuePriority(
					deps.priorityQueue,
					{
						kind: "recheck",
						domain: domainName,
						linkIds: [id],
						dueAt: outcome.recheck.dueAt,
					},
					outcome.recheck.delaySeconds,
				);
			} catch (err) {
				// The check is already recorded: the Dispatcher fallback (next_run_at) covers a lost recheck.
				log("Recheck not queued", {
					domain: domainName,
					id,
					error: String(err),
				});
			}
		}
	}

	return async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
		const limits = new Map<string, LimitFunction>();
		const limitFor = (domain: string) => {
			const existing = limits.get(domain);
			if (existing) return existing;
			const created = pLimit(PER_DOMAIN_CONCURRENCY);
			limits.set(domain, created);
			return created;
		};
		const failures: SQSBatchItemFailure[] = [];
		// FR-12 / FR-13: a handful of templates, read once per invocation.
		const templates = await loadScheduleTemplates(deps.db);
		for (const record of event.Records) {
			// FIFO: return a failed message and every later one to keep ordering within the group.
			// The priority Standard queue has no ordering, so only the failed message is returned.
			if (failures.length && isFifo(record)) {
				failures.push({ itemIdentifier: record.messageId });
				continue;
			}
			try {
				const job = CheckJob.parse(JSON.parse(record.body));
				const limit = limitFor(job.domain);
				// One domain per job (FR-14): read its settings once.
				const { data: domain } = await deps.db.Domain.get({
					name: job.domain,
				}).go();
				await Promise.all(
					job.linkIds.map((id) =>
						limit(() =>
							checkLink(
								job.domain,
								id,
								record.messageId,
								job.kind === "scheduled" ? job.dispatchedAt : undefined,
								domain,
								templates,
								job.kind === "verify" &&
									job.incidentId &&
									job.claimedAt &&
									job.attempt
									? {
											incidentId: job.incidentId,
											claimedAt: job.claimedAt,
											attempt: job.attempt,
										}
									: undefined,
							),
						),
					),
				);
			} catch (err) {
				log("Message failed", {
					messageId: record.messageId,
					error: String(err),
				});
				failures.push({ itemIdentifier: record.messageId });
			}
		}
		return { batchItemFailures: failures };
	};
}
