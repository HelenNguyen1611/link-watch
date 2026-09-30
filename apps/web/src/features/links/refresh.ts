import type { LinkStatus, LinkView } from "@linkwatch/core";

/** A check result is expected soon: new link (next Dispatcher tick) or recheck after 2 minutes (SRS 5.2). */
export const FAST_REFRESH_MS = 30_000;
/** Nothing is waiting: follow the Dispatcher cycle (every 5 minutes). */
export const SLOW_REFRESH_MS = 5 * 60_000;

/** Statuses whose next result is due within minutes. */
const WAITING: ReadonlySet<LinkStatus> = new Set(["pending", "suspect"]);

export const isWaitingForResult = (
	links: readonly Pick<LinkView, "status" | "paused">[],
) => links.some((l) => !l.paused && WAITING.has(l.status));

/**
 * Adaptive auto-refresh of the links list: every 30 s while an active link waits for a
 * check result, otherwise every 5 minutes (a full reload reads every link from DynamoDB).
 * No data yet (first load or error) → fast, so the page recovers quickly.
 */
export function refreshInterval(
	links: readonly Pick<LinkView, "status" | "paused">[] | undefined,
): number {
	if (!links) return FAST_REFRESH_MS;
	return isWaitingForResult(links) ? FAST_REFRESH_MS : SLOW_REFRESH_MS;
}
