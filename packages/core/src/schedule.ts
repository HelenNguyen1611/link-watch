/** Asia/Saigon has no daylight saving → fixed +07:00 offset (PLAN: technical decision). */
export const TZ_OFFSET_MS = 7 * 60 * 60_000;

/** FR-14: maximum offset when spreading checks scheduled for the same time. */
export const JITTER_MAX_MS = 5 * 60_000;

import type { ScheduleRule, ScheduleSource } from "./schema/schedule";

/** Fixed daily schedule, `at` = "HH:mm" in Asia/Saigon time. */
export type DailySchedule = { kind: "daily"; at: string };
/** FR-12: every kind of schedule (see `ScheduleRule`). */
export type Schedule = ScheduleRule;

/** FR-11: system-wide default schedule (until the admin edits the "default" schedule). */
export const DEFAULT_SCHEDULE: Schedule = { kind: "daily", at: "06:00" };

function parseHHmm(at: string): number {
	const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(at);
	if (!m)
		throw new Error(`Invalid time (expected HH:mm): ${JSON.stringify(at)}`);
	return (Number(m[1]) * 60 + Number(m[2])) * 60_000;
}

/** Local (Asia/Saigon) calendar parts of an instant, as a UTC-based Date for arithmetic. */
const local = (utcMs: number) => new Date(utcMs + TZ_OFFSET_MS);
/** UTC instant of a local calendar day at a local time of day. */
const utcOf = (year: number, month0: number, day: number, timeOfDay: number) =>
	Date.UTC(year, month0, day) + timeOfDay - TZ_OFFSET_MS;
const daysInMonth = (year: number, month0: number) =>
	new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
/** ISO weekday 1–7 of a local calendar day. */
const isoWeekday = (d: Date) => ((d.getUTCDay() + 6) % 7) + 1;

/**
 * Next run of the schedule, strictly after `after` (jitter not included).
 * - interval: next local wall-clock multiple of the interval (e.g. :00 :15 :30 :45);
 * - daily / weekly / monthly: next matching local day at `at`; monthly days past the end of
 *   a month run on its last day (once).
 */
export function computeNextRun(schedule: Schedule, after: Date): Date {
	const t = after.getTime();
	if (schedule.kind === "interval") {
		const step = schedule.minutes * 60_000;
		const localMs = t + TZ_OFFSET_MS;
		return new Date(Math.floor(localMs / step) * step + step - TZ_OFFSET_MS);
	}
	const timeOfDay = parseHHmm(schedule.at);
	const start = local(t);
	// At most ~62 days ahead for monthly (e.g. only day 31, starting in a 30-day month).
	for (let i = 0; i <= 62; i++) {
		const day = new Date(
			Date.UTC(
				start.getUTCFullYear(),
				start.getUTCMonth(),
				start.getUTCDate() + i,
			),
		);
		const y = day.getUTCFullYear();
		const m = day.getUTCMonth();
		const d = day.getUTCDate();
		let matches = schedule.kind === "daily";
		if (schedule.kind === "weekly")
			matches = schedule.days.includes(isoWeekday(day));
		if (schedule.kind === "monthly") {
			const last = daysInMonth(y, m);
			matches = schedule.days.some((wanted) => Math.min(wanted, last) === d);
		}
		if (!matches) continue;
		const at = utcOf(y, m, d, timeOfDay);
		if (at > t) return new Date(at);
	}
	throw new Error("No next run within 62 days");
}

/** Jitter bound for a schedule: never more than the interval itself. */
const jitterMax = (schedule: Schedule) =>
	schedule.kind === "interval"
		? Math.min(JITTER_MAX_MS, schedule.minutes * 60_000)
		: JITTER_MAX_MS;

/** FNV-1a 32 bit + fmix32 (MurmurHash3): stable across runs, evenly distributed even for near-identical ids. */
function hash32(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	h ^= h >>> 16;
	h = Math.imul(h, 0x85ebca6b);
	h ^= h >>> 13;
	h = Math.imul(h, 0xc2b2ae35);
	h ^= h >>> 16;
	return h >>> 0;
}

/** FR-14: fixed per-link-id offset in [0, max) (default 5 min) to spread checks due at the same time. */
export function applyJitter(
	base: Date,
	linkId: string,
	max = JITTER_MAX_MS,
): Date {
	const offset = Math.floor((hash32(linkId) / 2 ** 32) * max);
	return new Date(base.getTime() + offset);
}

/**
 * A link's `next_run_at`: next scheduled run + jitter. The check itself happens at
 * boundary + jitter, so the next boundary is looked up from `now` minus the jitter.
 */
export function nextRunAt(schedule: Schedule, linkId: string, now: Date): Date {
	const max = jitterMax(schedule);
	const offset = applyJitter(new Date(0), linkId, max).getTime();
	const base = computeNextRun(schedule, new Date(now.getTime() - offset));
	return new Date(base.getTime() + offset);
}

export type EffectiveSchedule = {
	rule: Schedule;
	source: ScheduleSource;
	/** Schedule template id; undefined only when the default template does not exist yet. */
	scheduleId?: string;
};

/**
 * FR-13: Link > Domain > Default. A missing template (deleted) falls through to the next level.
 * `templates` maps schedule ids to rules; "default" (FR-11) falls back to DEFAULT_SCHEDULE.
 */
export function resolveEffectiveSchedule(
	link: { scheduleId?: string },
	domain: { scheduleId?: string } | undefined,
	templates: ReadonlyMap<string, Schedule>,
): EffectiveSchedule {
	const linkRule = link.scheduleId ? templates.get(link.scheduleId) : undefined;
	if (link.scheduleId && linkRule)
		return { rule: linkRule, source: "link", scheduleId: link.scheduleId };
	const domainRule = domain?.scheduleId
		? templates.get(domain.scheduleId)
		: undefined;
	if (domain?.scheduleId && domainRule)
		return {
			rule: domainRule,
			source: "domain",
			scheduleId: domain.scheduleId,
		};
	const def = templates.get("default");
	return def
		? { rule: def, source: "default", scheduleId: "default" }
		: { rule: DEFAULT_SCHEDULE, source: "default" };
}

/** NFR-08: calendar day (YYYY-MM-DD) in Asia/Saigon, used as the DAY# key of daily stats. */
export function localDay(at: Date): string {
	return new Date(at.getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10);
}
