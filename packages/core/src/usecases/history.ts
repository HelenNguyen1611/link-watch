import type { Db } from "../db/index";
import type {
	CheckView,
	IncidentView,
	UptimeSummary,
} from "../schema/incident-view";
import { lastDays, summarizeUptime } from "../uptime";
import { toIncidentView } from "./incidents";
import { getLink } from "./links";

/** FR-18: the last `limit` checks of a link, newest first (checks are kept 90 days, NFR-08). */
export async function linkChecks(
	db: Db,
	linkId: string,
	limit = 100,
): Promise<CheckView[]> {
	await getLink(db, linkId);
	const { data } = await db.Check.query
		.byLink({ linkId })
		.go({ order: "desc", limit });
	return data.map((c) => ({
		checkedAt: c.checkedAt,
		result: c.result,
		responseMs: c.responseMs,
		...(c.httpCode !== undefined && { httpCode: c.httpCode }),
		...(c.finalUrl && { finalUrl: c.finalUrl }),
		...(c.errorType && { errorType: c.errorType }),
		...(c.errorMessage && { errorMessage: c.errorMessage }),
	}));
}

/** FR-18: uptime bar of the last `days` Asia/Saigon days (DAY# counters, NFR-08). */
export async function linkUptime(
	db: Db,
	linkId: string,
	{ now = new Date(), days = 30 }: { now?: Date; days?: number } = {},
): Promise<UptimeSummary> {
	await getLink(db, linkId);
	const window = lastDays(now, days);
	const { data } = await db.DayStat.query
		.primary({ linkId })
		.between(
			{ day: window[0] as string },
			{ day: window[window.length - 1] as string },
		)
		.go({ pages: "all" });
	return summarizeUptime(data, now, days);
}

/** FR-18: incidents of one link, newest first. */
export async function linkIncidents(
	db: Db,
	linkId: string,
	limit = 20,
): Promise<IncidentView[]> {
	await getLink(db, linkId);
	const { data } = await db.Incident.query
		.primary({ linkId })
		.go({ order: "desc", limit });
	return data.map(toIncidentView);
}
