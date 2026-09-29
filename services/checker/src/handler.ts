import { CheckJob, classify, type ProbeResult } from "@linkwatch/core";
import type { Db } from "@linkwatch/core/db";
import { recordCheck } from "@linkwatch/core/usecases";
import type {
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import pLimit, { type LimitFunction } from "p-limit";
import {
	type ProbeOptions,
	type ProbeTarget,
	probe as realProbe,
} from "./probe";

/** FR-14 / NFR-09: at most 2 concurrent requests per domain. */
export const PER_DOMAIN_CONCURRENCY = 2;

export type CheckerDeps = {
	db: Db;
	now?: () => Date;
	probe?: (target: ProbeTarget, opts: ProbeOptions) => Promise<ProbeResult>;
	probeOptions?: ProbeOptions;
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
		domain: string,
		id: string,
		jobId: string,
	): Promise<void> {
		const { data: link } = await deps.db.Link.get({ domain, id }).go();
		if (!link || link.deletedAt || link.paused) {
			log("Skipping link", {
				domain,
				id,
				reason: link ? "paused/deleted" : "not_found",
			});
			return;
		}
		// SQS redelivery of a job already recorded: no second request to the site.
		if (link.lastJobId === jobId) {
			log("Skipping link", { domain, id, reason: "duplicate_job" });
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
		});
		const outcome = await recordCheck(deps.db, link, checked, {
			now: now(),
			jobId,
		});
		if (outcome.kind === "skipped")
			log("Check not recorded", { domain, id, reason: outcome.reason });
		else if (outcome.evaluation.action.kind !== "none")
			log("Incident action", {
				domain,
				id,
				action: outcome.evaluation.action.kind,
			});
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
		// FIFO: return a failed message and every later one to keep ordering within the group.
		for (const record of event.Records) {
			if (failures.length) {
				failures.push({ itemIdentifier: record.messageId });
				continue;
			}
			try {
				const job = CheckJob.parse(JSON.parse(record.body));
				const limit = limitFor(job.domain);
				await Promise.all(
					job.linkIds.map((id) =>
						limit(() => checkLink(job.domain, id, record.messageId)),
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
