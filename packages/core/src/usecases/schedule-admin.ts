import type { Db } from "../db/index";
import { newId } from "../id";
import { DEFAULT_SCHEDULE, resolveEffectiveSchedule } from "../schedule";
import {
	DEFAULT_SCHEDULE_ID,
	ScheduleInput,
	ScheduleRule,
	type ScheduleView,
} from "../schema/schedule";
import { listAllLinks } from "./links";
import { rescheduleLinks } from "./reschedule";
import {
	DefaultScheduleError,
	loadScheduleTemplates,
	ScheduleInUseError,
	ScheduleNotFoundError,
} from "./schedules";

async function allDomains(db: Db) {
	const { data } = await db.Domain.query.all({}).go({ pages: "all" });
	return data;
}

/** FR-11 / FR-12: every template (the default one always listed), with direct usage counts. */
export async function listSchedules(db: Db): Promise<ScheduleView[]> {
	const [{ data }, domains, links] = await Promise.all([
		db.Schedule.query.all({}).go({ pages: "all" }),
		allDomains(db),
		listAllLinks(db),
	]);
	const rows = data
		.map((s) => ({
			id: s.id,
			name: s.name,
			rule: ScheduleRule.safeParse(s.rule),
		}))
		.filter((s) => s.rule.success)
		.map((s) => ({
			id: s.id,
			name: s.name,
			rule: s.rule.data as ScheduleView["rule"],
		}));
	if (!rows.some((s) => s.id === DEFAULT_SCHEDULE_ID))
		rows.unshift({
			id: DEFAULT_SCHEDULE_ID,
			name: "Default",
			rule: DEFAULT_SCHEDULE,
		});
	return rows
		.map((s) => ({
			...s,
			usedBy: {
				domains: domains.filter((d) => d.scheduleId === s.id).length,
				links: links.filter((l) => l.scheduleId === s.id).length,
			},
		}))
		.sort((a, b) =>
			a.id === DEFAULT_SCHEDULE_ID
				? -1
				: b.id === DEFAULT_SCHEDULE_ID
					? 1
					: a.name.localeCompare(b.name),
		);
}

/** FR-12: new template. */
export async function createSchedule(
	db: Db,
	raw: unknown,
	{ now = new Date() }: { now?: Date } = {},
): Promise<ScheduleView> {
	const input = ScheduleInput.parse(raw);
	const id = newId(now);
	await db.Schedule.create({ id, name: input.name, rule: input.rule }).go();
	return { id, ...input };
}

/**
 * FR-11 / FR-12: rename or change a template (the default one is created on first edit).
 * A new rule reschedules every link whose effective schedule is this template (FR-13).
 */
export async function updateSchedule(
	db: Db,
	id: string,
	raw: unknown,
	{ now = new Date() }: { now?: Date } = {},
): Promise<ScheduleView> {
	const input = ScheduleInput.partial().strict().parse(raw);
	const { data: current } = await db.Schedule.get({ id }).go();
	if (!current && id !== DEFAULT_SCHEDULE_ID)
		throw new ScheduleNotFoundError(id);
	const name = input.name ?? current?.name ?? "Default";
	const rule =
		input.rule ?? ScheduleRule.parse(current?.rule ?? DEFAULT_SCHEDULE);
	await db.Schedule.put({ id, name, rule }).go();

	if (input.rule) {
		const [templates, domains, links] = await Promise.all([
			loadScheduleTemplates(db),
			allDomains(db),
			listAllLinks(db),
		]);
		const domainMap = new Map(domains.map((d) => [d.name, d]));
		const affected = links.filter(
			(l) =>
				resolveEffectiveSchedule(l, domainMap.get(l.domain), templates)
					.scheduleId === id,
		);
		await rescheduleLinks(db, affected, { now, templates, domains: domainMap });
	}
	return { id, name, rule };
}

/** FR-12: delete an unused template; the default one cannot be deleted. */
export async function deleteSchedule(db: Db, id: string): Promise<void> {
	if (id === DEFAULT_SCHEDULE_ID) throw new DefaultScheduleError();
	const { data } = await db.Schedule.get({ id }).go();
	if (!data) throw new ScheduleNotFoundError(id);
	const [domains, links] = await Promise.all([
		allDomains(db),
		listAllLinks(db),
	]);
	const usedBy = {
		domains: domains.filter((d) => d.scheduleId === id).length,
		links: links.filter((l) => l.scheduleId === id).length,
	};
	if (usedBy.domains + usedBy.links > 0)
		throw new ScheduleInUseError(id, usedBy);
	await db.Schedule.delete({ id }).go();
}

/** FR-13: a schedule id given by the user must exist (the default one always does). */
export async function assertScheduleExists(db: Db, id: string): Promise<void> {
	if (id === DEFAULT_SCHEDULE_ID) return;
	const { data } = await db.Schedule.get({ id }).go();
	if (!data) throw new ScheduleNotFoundError(id);
}
