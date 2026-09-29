import type { ClassifiedCheck } from "../classify";
import { dayStatTtl } from "../db/entities/day-stat";
import type { Db } from "../db/index";
import {
	type ActiveIncident,
	type Evaluation,
	evaluateCheck,
} from "../incident";
import { DEFAULT_SCHEDULE, localDay, type Schedule } from "../schedule";
import type { LinkStatus } from "../schema/enums";

const isConditionalFailure = (err: unknown) =>
	/ConditionalCheckFailed|conditional request failed/i.test(
		`${String(err)} ${String((err as { cause?: unknown })?.cause)}`,
	);

export type CheckedLink = {
	domain: string;
	id: string;
	url: string;
	status?: LinkStatus;
	paused?: boolean;
};

export type RecordCheckOptions = {
	now: Date;
	/**
	 * Id of the job that triggered the check (SQS messageId). A redelivered job with the
	 * same id is ignored, so one failure is never counted twice (SRS 5.2).
	 */
	jobId: string;
	schedule?: Schedule;
};

export type RecordCheckOutcome =
	| { kind: "recorded"; evaluation: Evaluation }
	/** FR-04 paused, deleted/paused during the check, or the same job already recorded. */
	| { kind: "skipped"; reason: "paused" | "duplicate_or_changed" };

/** SRS 5.2: the incident that is not closed yet, if any (latest incident of the link). */
export async function findActiveIncident(
	db: Db,
	linkId: string,
): Promise<ActiveIncident | undefined> {
	const { data } = await db.Incident.query
		.primary({ linkId })
		.go({ order: "desc", limit: 1 });
	const latest = data[0];
	if (!latest || latest.state === "closed") return undefined;
	return { openedAt: latest.openedAt, type: latest.type, state: latest.state };
}

/**
 * SRS 5.2 + FR-17: stores one check of a link and applies the incident state machine.
 *
 * Order of writes: the Link update is the commit point — it is conditional on the link
 * still being active and on `lastJobId` differing from `jobId`. Only then are the check
 * record, the daily stat (NFR-08) and the incident open/close written. If the Lambda dies
 * after the commit point, those follow-up writes of that one check are lost; an incident
 * that failed to open is opened again by the next failing checks.
 */
export async function recordCheck(
	db: Db,
	link: CheckedLink,
	checked: ClassifiedCheck,
	opts: RecordCheckOptions,
): Promise<RecordCheckOutcome> {
	const { now, jobId } = opts;
	const checkedAt = now.toISOString();
	const openIncident = await findActiveIncident(db, link.id);
	const evaluation = evaluateCheck(
		{
			status: link.status ?? "pending",
			paused: link.paused ?? false,
			openIncident,
		},
		checked,
		{ now, schedule: opts.schedule ?? DEFAULT_SCHEDULE, linkId: link.id },
	);
	if (evaluation.action.kind === "skip")
		return { kind: "skipped", reason: "paused" };

	const removed = [
		checked.httpCode === undefined && "lastHttpCode",
		checked.errorType === undefined && "lastErrorType",
		evaluation.nextRunAt === undefined && "nextRunAt",
	].filter((k): k is "lastHttpCode" | "lastErrorType" | "nextRunAt" =>
		Boolean(k),
	);
	try {
		let update = db.Link.patch({ domain: link.domain, id: link.id }).set({
			status: evaluation.status,
			lastCheckedAt: checkedAt,
			lastResponseMs: checked.responseMs,
			lastJobId: jobId,
			...(checked.httpCode !== undefined && { lastHttpCode: checked.httpCode }),
			...(checked.errorType && { lastErrorType: checked.errorType }),
			...(evaluation.nextRunAt && {
				nextRunAt: evaluation.nextRunAt.toISOString(),
			}),
		});
		if (removed.length) update = update.remove(removed) as typeof update;
		await update
			.where(
				({ deletedAt, paused, lastJobId }, { notExists, eq, ne }) =>
					`${notExists(deletedAt)} AND ${eq(paused, false)} AND (${notExists(lastJobId)} OR ${ne(lastJobId, jobId)})`,
			)
			.go();
	} catch (err) {
		if (!isConditionalFailure(err)) throw err;
		return { kind: "skipped", reason: "duplicate_or_changed" };
	}

	const day = localDay(now);
	await Promise.all([
		// put (not create): same key on a retry overwrites instead of failing.
		db.Check.put({ linkId: link.id, checkedAt, ...checked }).go(),
		db.DayStat.update({ linkId: link.id, day })
			.add({
				checks: 1,
				[checked.result]: 1,
				totalResponseMs: checked.responseMs,
			})
			.set({ ttl: dayStatTtl(day) })
			.go(),
		applyIncidentAction(db, link, checked, evaluation),
	]);
	return { kind: "recorded", evaluation };
}

async function applyIncidentAction(
	db: Db,
	link: CheckedLink,
	checked: ClassifiedCheck,
	{ action }: Evaluation,
): Promise<void> {
	if (action.kind === "open") {
		try {
			await db.Incident.create({
				linkId: link.id,
				openedAt: action.openedAt,
				domain: link.domain,
				url: link.url,
				type: action.type,
				...(checked.httpCode !== undefined && { httpCode: checked.httpCode }),
				...(checked.errorType && { errorType: checked.errorType }),
			}).go();
		} catch (err) {
			if (!isConditionalFailure(err)) throw err;
		}
		return;
	}
	if (action.kind === "close") {
		await db.Incident.patch({ linkId: link.id, openedAt: action.openedAt })
			.set({
				state: "closed",
				closedAt: action.closedAt,
				closedReason: "recovered",
				downtimeMs: action.downtimeMs,
			})
			.go();
	}
}
