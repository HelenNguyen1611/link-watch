import { aggregateDomainStatus } from "./domain-status";
import {
	type EffectiveSchedule,
	resolveEffectiveSchedule,
	type Schedule,
} from "./schedule";
import type { LinkStatus } from "./schema/enums";
import type { LinkView } from "./schema/link-view";

export type DomainUptime = { uptime7?: number; uptime30?: number };

export type DomainRowInput = {
	name: string;
	displayName?: string;
	description?: string;
	owner?: string;
	scheduleId?: string;
	enabled?: boolean;
	slowAlert?: boolean;
	ignoreWaf403?: boolean;
};

export type DomainSummary = DomainRowInput & {
	enabled: boolean;
	slowAlert: boolean;
	ignoreWaf403: boolean;
	/** FR-09 aggregate. */
	status: ReturnType<typeof aggregateDomainStatus>;
	/** FR-10: links per status (active links only) and paused links. */
	counts: Record<LinkStatus, number>;
	paused: number;
	total: number;
	avgResponseMs?: number;
	lastCheckedAt?: string;
	nextRunAt?: string;
	uptime7?: number;
	uptime30?: number;
	/** FR-13: domain schedule, with where it comes from. */
	schedule: { source: EffectiveSchedule["source"]; scheduleId?: string };
};

const EMPTY_COUNTS = (): Record<LinkStatus, number> => ({
	pending: 0,
	up: 0,
	slow: 0,
	dead: 0,
	down: 0,
	suspect: 0,
});

/**
 * FR-09 / FR-10 / NFR-02: per-domain overview computed from the links snapshot rows and the
 * precomputed uptime — no read of the links' history. Domains without links are listed too.
 */
export function summarizeDomains(
	domains: readonly DomainRowInput[],
	links: readonly LinkView[],
	uptime: Readonly<Record<string, DomainUptime>>,
	templates: ReadonlyMap<string, Schedule>,
): DomainSummary[] {
	const byDomain = new Map<string, LinkView[]>();
	for (const l of links)
		byDomain.set(l.domain, [...(byDomain.get(l.domain) ?? []), l]);
	return domains
		.map((d) => {
			const rows = byDomain.get(d.name) ?? [];
			const active = rows.filter((l) => !l.paused);
			const counts = EMPTY_COUNTS();
			for (const l of active) counts[l.status]++;
			const times = active
				.map((l) => l.lastResponseMs)
				.filter((v): v is number => v !== undefined);
			const checked = rows
				.map((l) => l.lastCheckedAt)
				.filter((v): v is string => Boolean(v));
			const next = active
				.map((l) => l.nextRunAt)
				.filter((v): v is string => Boolean(v));
			const eff = resolveEffectiveSchedule({}, d, templates);
			return {
				...d,
				enabled: d.enabled ?? true,
				slowAlert: d.slowAlert ?? false,
				ignoreWaf403: d.ignoreWaf403 ?? false,
				status: aggregateDomainStatus(rows),
				counts,
				paused: rows.length - active.length,
				total: rows.length,
				...(times.length > 0 && {
					avgResponseMs: Math.round(
						times.reduce((a, b) => a + b, 0) / times.length,
					),
				}),
				...(checked.length > 0 && { lastCheckedAt: checked.sort().at(-1) }),
				...(next.length > 0 && { nextRunAt: next.sort()[0] }),
				...uptime[d.name],
				schedule: {
					source: eff.source,
					...(eff.scheduleId && { scheduleId: eff.scheduleId }),
				},
			};
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}
