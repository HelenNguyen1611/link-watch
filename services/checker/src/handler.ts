import {
	CheckJob,
	classify,
	DEFAULT_SCHEDULE,
	nextRunAt,
	type ProbeResult,
} from "@linkwatch/core";
import type { Db } from "@linkwatch/core/db";
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

/** FR-14 / NFR-09: tối đa 2 request đồng thời trên mỗi domain. */
export const PER_DOMAIN_CONCURRENCY = 2;

export type CheckerDeps = {
	db: Db;
	now?: () => Date;
	probe?: (target: ProbeTarget, opts: ProbeOptions) => Promise<ProbeResult>;
	probeOptions?: ProbeOptions;
	log?: (message: string, extra?: Record<string, unknown>) => void;
};

/**
 * SQS (FIFO, MessageGroupId = domain) → check từng link → ghi kết quả.
 * Bản Mốc 1: chưa có xác nhận 2 lần / incident (Bước 12b).
 */
export function createHandler(deps: CheckerDeps) {
	const now = deps.now ?? (() => new Date());
	const probe = deps.probe ?? realProbe;
	const log = deps.log ?? (() => {});

	async function checkLink(domain: string, id: string): Promise<void> {
		const { data: link } = await deps.db.Link.get({ domain, id }).go();
		if (!link || link.deletedAt || link.paused) {
			log("Bỏ qua link", {
				domain,
				id,
				reason: link ? "paused/deleted" : "not_found",
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
		});
		const checkedAt = now().toISOString();

		// put (không phải create): SQS retry cùng message ghi đè cùng khóa thay vì lỗi mãi.
		await deps.db.Check.put({ linkId: id, checkedAt, ...checked }).go();

		const cleared = (["lastHttpCode", "lastErrorType"] as const).filter(
			(k) =>
				(k === "lastHttpCode" ? checked.httpCode : checked.errorType) ===
				undefined,
		);
		try {
			let update = deps.db.Link.patch({ domain, id }).set({
				status: checked.result,
				lastCheckedAt: checkedAt,
				lastResponseMs: checked.responseMs,
				...(checked.httpCode !== undefined && {
					lastHttpCode: checked.httpCode,
				}),
				...(checked.errorType && { lastErrorType: checked.errorType }),
				nextRunAt: nextRunAt(DEFAULT_SCHEDULE, id, now()).toISOString(),
			});
			if (cleared.length) update = update.remove(cleared) as typeof update;
			// Link bị xóa/tạm dừng trong lúc check thì không đặt lại next_run_at.
			await update
				.where(
					({ deletedAt, paused }, { notExists, eq }) =>
						`${notExists(deletedAt)} AND ${eq(paused, false)}`,
				)
				.go();
		} catch (err) {
			if (
				!/ConditionalCheckFailed|conditional request failed/i.test(String(err))
			)
				throw err;
			log("Link đổi trạng thái trong lúc check", { domain, id });
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
		// FIFO: message lỗi thì trả lại nó và mọi message sau để giữ thứ tự trong group.
		for (const record of event.Records) {
			if (failures.length) {
				failures.push({ itemIdentifier: record.messageId });
				continue;
			}
			try {
				const job = CheckJob.parse(JSON.parse(record.body));
				const limit = limitFor(job.domain);
				await Promise.all(
					job.linkIds.map((id) => limit(() => checkLink(job.domain, id))),
				);
			} catch (err) {
				log("Message lỗi", { messageId: record.messageId, error: String(err) });
				failures.push({ itemIdentifier: record.messageId });
			}
		}
		return { batchItemFailures: failures };
	};
}
