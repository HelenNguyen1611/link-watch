import type {
	DomainStatus,
	DomainSummary,
	IncidentView,
	LinkStatus,
} from "@linkwatch/core";

/** Worst first — the order of the "needs attention" list (FR-09). */
export const DOMAIN_SEVERITY: readonly DomainStatus[] = [
	"down",
	"error",
	"warning",
	"normal",
];

export type OverviewTotals = {
	domains: Record<DomainStatus, number>;
	links: Record<LinkStatus, number>;
	/** Active (not paused) links. */
	active: number;
	paused: number;
	/** Link-weighted 7-day uptime across domains with data. */
	uptime7?: number;
};

/** SCR-01: totals over the per-domain summaries the API already aggregated (NFR-02). */
export function overviewTotals(
	domains: readonly DomainSummary[],
): OverviewTotals {
	const out: OverviewTotals = {
		domains: { down: 0, error: 0, warning: 0, normal: 0 },
		links: { pending: 0, up: 0, slow: 0, dead: 0, down: 0, suspect: 0 },
		active: 0,
		paused: 0,
	};
	let weighted = 0;
	let weight = 0;
	for (const d of domains) {
		out.domains[d.status]++;
		for (const [s, n] of Object.entries(d.counts))
			out.links[s as LinkStatus] += n;
		const active = d.total - d.paused;
		out.active += active;
		out.paused += d.paused;
		if (d.uptime7 !== undefined && active > 0) {
			weighted += d.uptime7 * active;
			weight += active;
		}
	}
	if (weight > 0) out.uptime7 = Math.round((weighted / weight) * 100) / 100;
	return out;
}

/** Domains that are not Normal, worst first, then by name. */
export function needsAttention(
	domains: readonly DomainSummary[],
): DomainSummary[] {
	const rank = (d: DomainSummary) => DOMAIN_SEVERITY.indexOf(d.status);
	return domains
		.filter((d) => d.enabled && d.status !== "normal")
		.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** Window of the "resolved recently" list on the overview. */
export const RECENT_WINDOW_MS = 24 * 60 * 60_000;

/** SCR-01: incidents closed within `windowMs` before `now`, most recently closed first. */
export function recentlyClosed(
	incidents: readonly IncidentView[],
	now: Date,
	windowMs = RECENT_WINDOW_MS,
): IncidentView[] {
	const since = now.getTime() - windowMs;
	return incidents
		.filter(
			(i) =>
				i.state === "closed" &&
				i.closedAt !== undefined &&
				Date.parse(i.closedAt) >= since,
		)
		.sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""));
}
