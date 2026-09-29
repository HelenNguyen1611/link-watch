/** Asia/Saigon has no daylight saving → fixed +07:00 offset (PLAN: technical decision). */
export const TZ_OFFSET_MS = 7 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/** FR-14: maximum offset when spreading checks scheduled for the same time. */
export const JITTER_MAX_MS = 5 * 60_000;

/** Fixed daily schedule, `at` = "HH:mm" in Asia/Saigon time. Other kinds are added in step 3b. */
export type DailySchedule = { kind: "daily"; at: string };
export type Schedule = DailySchedule;

/** FR-11: system-wide default schedule. */
export const DEFAULT_SCHEDULE: Schedule = { kind: "daily", at: "06:00" };

function parseHHmm(at: string): number {
	const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(at);
	if (!m)
		throw new Error(`Invalid time (expected HH:mm): ${JSON.stringify(at)}`);
	return (Number(m[1]) * 60 + Number(m[2])) * 60_000;
}

/** Next run of the schedule, always after `after` (jitter not included). */
export function computeNextRun(schedule: Schedule, after: Date): Date {
	const timeOfDay = parseHHmm(schedule.at);
	const localNow = after.getTime() + TZ_OFFSET_MS;
	const localMidnight = localNow - (((localNow % DAY_MS) + DAY_MS) % DAY_MS);
	let next = localMidnight + timeOfDay - TZ_OFFSET_MS;
	if (next <= after.getTime()) next += DAY_MS;
	return new Date(next);
}

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

/** FR-14: fixed per-link-id offset in [0, 5 min) to spread checks scheduled for the same time. */
export function applyJitter(base: Date, linkId: string): Date {
	const offset = Math.floor((hash32(linkId) / 2 ** 32) * JITTER_MAX_MS);
	return new Date(base.getTime() + offset);
}

/** A link's `next_run_at`: next scheduled run + jitter. */
export function nextRunAt(schedule: Schedule, linkId: string, now: Date): Date {
	return applyJitter(computeNextRun(schedule, now), linkId);
}

/** NFR-08: calendar day (YYYY-MM-DD) in Asia/Saigon, used as the DAY# key of daily stats. */
export function localDay(at: Date): string {
	return new Date(at.getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10);
}
