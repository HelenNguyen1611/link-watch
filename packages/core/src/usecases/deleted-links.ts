import type { Db } from "../db/index";

const isConditionalFailure = (err: unknown) =>
	/ConditionalCheckFailed|conditional request failed/i.test(
		`${String(err)} ${String((err as { cause?: unknown })?.cause)}`,
	);

/**
 * FR-04: a deleted link is never checked again, so its open incident would never recover
 * and would keep sending reminders (FR-23). Closes every Open/Verifying incident of the link
 * with `closedReason: "link_deleted"` — no recovery email (the Alert stream skips it).
 * Downtime counts until the deletion. Returns how many incidents were closed.
 */
export async function closeIncidentsOfDeletedLink(
	db: Db,
	linkId: string,
	{ now = new Date() }: { now?: Date } = {},
): Promise<number> {
	const { data } = await db.Incident.query
		.primary({ linkId })
		.go({ pages: "all" });
	let closed = 0;
	for (const incident of data) {
		if (incident.state === "closed") continue;
		try {
			await db.Incident.patch({ linkId, openedAt: incident.openedAt })
				.set({
					state: "closed",
					closedAt: now.toISOString(),
					closedReason: "link_deleted",
					downtimeMs: Math.max(
						0,
						now.getTime() - Date.parse(incident.openedAt),
					),
				})
				.where(({ state }, { ne }) => ne(state, "closed"))
				.go();
			closed++;
		} catch (err) {
			// Closed meanwhile (recovered or verified): nothing to do.
			if (!isConditionalFailure(err)) throw err;
		}
	}
	return closed;
}

/**
 * FR-23: ids of the given links that are soft-deleted (the record is kept, FR-04). A link
 * with no record at all is not treated as deleted. Looked up by id (GSI3), not by the domain
 * copied into the incident: editing a URL can move a link to another domain.
 */
export async function findDeletedLinkIds(
	db: Db,
	linkIds: Iterable<string>,
): Promise<Set<string>> {
	const deleted = new Set<string>();
	for (const id of new Set(linkIds)) {
		const { data } = await db.Link.query.byId({ id }).go();
		if (data.length > 0 && data.every((l) => l.deletedAt)) deleted.add(id);
	}
	return deleted;
}
