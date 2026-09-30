import type { Db } from "../db/index";
import { type DomainSummary, summarizeDomains } from "../domain-summary";
import { DomainUpdate } from "../schema/domain";
import type { UptimeSummary } from "../schema/incident-view";
import { toLinkView } from "../schema/link-view";
import { summarizeUptime } from "../uptime";
import { rescheduleLinks } from "./reschedule";
import { assertScheduleExists } from "./schedule-admin";
import { loadScheduleTemplates } from "./schedules";
import { readLinkSnapshot, type SnapshotStore } from "./snapshot";

export class DomainNotFoundError extends Error {
	readonly code = "not_found";
	constructor(readonly name: string) {
		super(`Domain not found: ${name}`);
		this.name = "DomainNotFoundError";
	}
}

export async function getDomainRow(db: Db, name: string) {
	const { data } = await db.Domain.get({ name }).go();
	if (!data) throw new DomainNotFoundError(name);
	return data;
}

/**
 * FR-08 / FR-13 / SRS 3.4: edit a domain. A new schedule reschedules its links that have
 * no schedule of their own.
 */
export async function updateDomain(
	db: Db,
	name: string,
	raw: unknown,
	{ now = new Date() }: { now?: Date } = {},
) {
	const input = DomainUpdate.parse(raw);
	const current = await getDomainRow(db, name);
	if (input.scheduleId) await assertScheduleExists(db, input.scheduleId);
	const set: Record<string, unknown> = {};
	const remove: ("displayName" | "description" | "owner" | "scheduleId")[] = [];
	for (const [k, v] of Object.entries(input))
		if (v === null) remove.push(k as (typeof remove)[number]);
		else set[k] = v;
	let patch = db.Domain.patch({ name }).set(set);
	if (remove.length) patch = patch.remove(remove) as typeof patch;
	await patch.go();

	if (
		"scheduleId" in input &&
		(input.scheduleId ?? undefined) !== current.scheduleId
	) {
		const { data: links } = await db.Link.query
			.primary({ domain: name })
			.go({ pages: "all" });
		await rescheduleLinks(
			db,
			links.filter((l) => !l.scheduleId),
			{ now },
		);
	}
	return getDomainRow(db, name);
}

/**
 * FR-09 / FR-10 / NFR-02: every domain with its overview, from the links snapshot and the
 * hourly uptime cache — no scan of links or check history.
 */
export async function listDomainSummaries(
	db: Db,
	store: SnapshotStore | undefined,
	now: Date = new Date(),
): Promise<{ items: DomainSummary[]; generatedAt: string }> {
	const [snapshot, { data: domains }, templates] = await Promise.all([
		readLinkSnapshot(db, store, now),
		db.Domain.query.all({}).go({ pages: "all" }),
		loadScheduleTemplates(db),
	]);
	return {
		items: summarizeDomains(
			domains,
			snapshot.items,
			snapshot.uptime?.byDomain ?? {},
			templates,
		),
		generatedAt: snapshot.generatedAt,
	};
}

export type DomainDetail = DomainSummary & { uptimeDays: UptimeSummary };

/** FR-10: one domain with live counts (its own partition) and its 30-day uptime bar. */
export async function getDomainDetail(
	db: Db,
	name: string,
	now: Date = new Date(),
): Promise<DomainDetail> {
	const row = await getDomainRow(db, name);
	const [{ data: links }, { data: days }, templates] = await Promise.all([
		db.Link.query.primary({ domain: name }).go({ pages: "all" }),
		db.DomainDayStat.query
			.primary({ domain: name })
			.gte({
				day: new Date(now.getTime() - 31 * 86_400_000)
					.toISOString()
					.slice(0, 10),
			})
			.go({ pages: "all" }),
		loadScheduleTemplates(db),
	]);
	const u7 = summarizeUptime(days, now, 7).uptimePct;
	const uptimeDays = summarizeUptime(days, now, 30);
	const [summary] = summarizeDomains(
		[row],
		links.filter((l) => !l.deletedAt).map(toLinkView),
		{
			[name]: {
				...(u7 !== undefined && { uptime7: u7 }),
				...(uptimeDays.uptimePct !== undefined && {
					uptime30: uptimeDays.uptimePct,
				}),
			},
		},
		templates,
	);
	return { ...(summary as DomainSummary), uptimeDays };
}
