import type { Db } from "../db/index";
import {
	nextRunAt,
	resolveEffectiveSchedule,
	type Schedule,
} from "../schedule";
import { loadScheduleTemplates } from "./schedules";

type LinkRow = {
	domain: string;
	id: string;
	scheduleId?: string;
	paused?: boolean;
	deletedAt?: string;
};

const isConditionalFailure = (err: unknown) =>
	/ConditionalCheckFailed|conditional request failed/i.test(
		`${String(err)} ${String((err as { cause?: unknown })?.cause)}`,
	);

/**
 * FR-13: after a schedule assignment or a template change, recompute `next_run_at` of the
 * given links from their effective schedule, so the change applies now instead of after the
 * next check (which could be a week away). Paused and deleted links are left alone.
 */
export async function rescheduleLinks(
	db: Db,
	links: readonly LinkRow[],
	{
		now = new Date(),
		templates,
		domains,
	}: {
		now?: Date;
		templates?: ReadonlyMap<string, Schedule>;
		domains?: ReadonlyMap<string, { scheduleId?: string }>;
	} = {},
): Promise<number> {
	const active = links.filter((l) => !l.paused && !l.deletedAt);
	if (active.length === 0) return 0;
	const rules = templates ?? (await loadScheduleTemplates(db));
	const domainRows = new Map(domains ?? []);
	for (const name of new Set(active.map((l) => l.domain)))
		if (!domainRows.has(name)) {
			const { data } = await db.Domain.get({ name }).go();
			domainRows.set(name, data ?? {});
		}
	let updated = 0;
	for (const link of active) {
		const { rule } = resolveEffectiveSchedule(
			link,
			domainRows.get(link.domain),
			rules,
		);
		try {
			await db.Link.patch({ domain: link.domain, id: link.id })
				.set({ nextRunAt: nextRunAt(rule, link.id, now).toISOString() })
				.where(
					({ deletedAt, paused }, { notExists, eq }) =>
						`${notExists(deletedAt)} AND ${eq(paused, false)}`,
				)
				.go();
			updated++;
		} catch (err) {
			if (!isConditionalFailure(err)) throw err;
		}
	}
	return updated;
}
