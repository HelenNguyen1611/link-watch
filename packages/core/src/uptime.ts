import { localDay } from "./schedule";
import type { UptimeDay, UptimeSummary } from "./schema/incident-view";

const DAY_MS = 24 * 60 * 60_000;

export type DayStatRow = {
	day: string;
	checks?: number;
	up?: number;
	slow?: number;
	dead?: number;
	down?: number;
	totalResponseMs?: number;
};

const pct = (ok: number, total: number) =>
	total > 0 ? Math.round((ok / total) * 10_000) / 100 : undefined;

/** Asia/Saigon days of the last `days` days, oldest first, ending today. */
export function lastDays(now: Date, days: number): string[] {
	return Array.from({ length: days }, (_, i) =>
		localDay(new Date(now.getTime() - (days - 1 - i) * DAY_MS)),
	);
}

/**
 * FR-18: uptime bar — one entry per day (days without checks are kept, with no percentage).
 * Uptime = up + slow over all checks: Slow is a working link (SRS 5.1).
 */
export function summarizeUptime(
	rows: readonly DayStatRow[],
	now: Date,
	days = 30,
): UptimeSummary {
	const byDay = new Map(rows.map((r) => [r.day, r]));
	let checks = 0;
	let ok = 0;
	const out: UptimeDay[] = lastDays(now, days).map((day) => {
		const r = byDay.get(day);
		const c = r?.checks ?? 0;
		const up = r?.up ?? 0;
		const slow = r?.slow ?? 0;
		checks += c;
		ok += up + slow;
		const uptimePct = pct(up + slow, c);
		return {
			day,
			checks: c,
			up,
			slow,
			dead: r?.dead ?? 0,
			down: r?.down ?? 0,
			...(uptimePct !== undefined && { uptimePct }),
			...(c > 0 && {
				avgResponseMs: Math.round((r?.totalResponseMs ?? 0) / c),
			}),
		};
	});
	const uptimePct = pct(ok, checks);
	return { days: out, checks, ...(uptimePct !== undefined && { uptimePct }) };
}
