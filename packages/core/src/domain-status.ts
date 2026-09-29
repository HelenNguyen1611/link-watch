import type { DomainStatus, LinkStatus } from "./schema/enums";

/**
 * FR-09: aggregate domain status. Down if ≥ 1 link is Site down; Error if ≥ 1 dead link;
 * Warning if ≥ 1 slow link; otherwise Normal. Paused links are ignored (FR-04);
 * `pending` and `suspect` are not confirmed failures and count as normal.
 */
export function aggregateDomainStatus(
	links: ReadonlyArray<{ status: LinkStatus; paused: boolean }>,
): DomainStatus {
	const active = links.filter((l) => !l.paused);
	if (active.some((l) => l.status === "down")) return "down";
	if (active.some((l) => l.status === "dead")) return "error";
	if (active.some((l) => l.status === "slow")) return "warning";
	return "normal";
}
