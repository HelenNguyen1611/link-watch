import type { Db } from "../db/index";
import { incidentId, parseIncidentId } from "../incident";
import {
	AckInput,
	type IncidentDetail,
	type IncidentPage,
	type IncidentView,
} from "../schema/incident-view";

export class IncidentNotFoundError extends Error {
	readonly code = "not_found";
	constructor(readonly id: string) {
		super(`Incident not found: ${id}`);
		this.name = "IncidentNotFoundError";
	}
}

export class IncidentClosedError extends Error {
	readonly code = "incident_closed";
	constructor(readonly id: string) {
		super(`Incident already closed: ${id}`);
		this.name = "IncidentClosedError";
	}
}

type IncidentRow = NonNullable<
	Awaited<ReturnType<ReturnType<Db["Incident"]["get"]>["go"]>>["data"]
>;

const KEYS = [
	"linkId",
	"domain",
	"url",
	"type",
	"state",
	"openedAt",
	"closedAt",
	"closedReason",
	"downtimeMs",
	"httpCode",
	"errorType",
	"ackedBy",
	"ackedAt",
	"note",
] as const;

/** Drops internal fields before returning to the web. */
export function toIncidentView(row: IncidentRow): IncidentView {
	const out: Record<string, unknown> = {
		id: incidentId(row.linkId, row.openedAt),
	};
	for (const k of KEYS) if (row[k] !== undefined) out[k] = row[k];
	return out as IncidentView;
}

const byNewest = (a: IncidentView, b: IncidentView) =>
	b.openedAt.localeCompare(a.openedAt);

/**
 * FR-19: incidents newest first. `active` = Open and Verifying (usually few, returned in
 * full); `closed` is paged with a cursor (GSI2, pk INC#closed).
 */
export async function listIncidents(
	db: Db,
	opts: { state: "active" | "closed"; limit?: number; cursor?: string | null },
): Promise<IncidentPage> {
	if (opts.state === "active") {
		const [open, verifying] = await Promise.all(
			(["open", "verifying"] as const).map((state) =>
				db.Incident.query.byState({ state }).go({ pages: "all" }),
			),
		);
		const items = [...(open?.data ?? []), ...(verifying?.data ?? [])]
			.map(toIncidentView)
			.sort(byNewest);
		return { items, cursor: null };
	}
	const page = await db.Incident.query.byState({ state: "closed" }).go({
		order: "desc",
		limit: opts.limit ?? 50,
		cursor: opts.cursor ?? null,
	});
	return { items: page.data.map(toIncidentView), cursor: page.cursor ?? null };
}

async function getRow(db: Db, id: string) {
	let key: { linkId: string; openedAt: string };
	try {
		key = parseIncidentId(id);
	} catch {
		throw new IncidentNotFoundError(id);
	}
	const { data } = await db.Incident.get(key).go();
	if (!data) throw new IncidentNotFoundError(id);
	return data;
}

/** FR-19: one incident with the emails sent about it (MAIL# log, FR-25), oldest first. */
export async function getIncident(db: Db, id: string): Promise<IncidentDetail> {
	const row = await getRow(db, id);
	const { data: mails } = await db.Notification.query
		.byIncident({ incidentId: id })
		.go({ pages: "all" });
	return {
		...toIncidentView(row),
		notifications: mails.map((m) => ({
			to: m.to,
			kind: m.kind,
			status: m.status,
			sentAt: m.sentAt,
			...(m.error && { error: m.error }),
		})),
	};
}

/**
 * FR-19 / FR-23: Acknowledge an incident that is not closed (stops reminders); calling it
 * again updates the note. `by` is the signed-in user's email.
 */
export async function acknowledgeIncident(
	db: Db,
	id: string,
	raw: unknown,
	{ by, now = new Date() }: { by: string; now?: Date },
): Promise<IncidentView> {
	const input = AckInput.parse(raw ?? {});
	const row = await getRow(db, id);
	if (row.state === "closed") throw new IncidentClosedError(id);
	const note = input.note ? input.note : undefined;
	let update = db.Incident.patch({
		linkId: row.linkId,
		openedAt: row.openedAt,
	}).set({
		ackedBy: by,
		ackedAt: row.ackedAt ?? now.toISOString(),
		...(note && { note }),
	});
	if (input.note === "") update = update.remove(["note"]) as typeof update;
	try {
		await update.where(({ state }, { ne }) => ne(state, "closed")).go();
	} catch (err) {
		if (/ConditionalCheckFailed|conditional request failed/i.test(String(err)))
			throw new IncidentClosedError(id);
		throw err;
	}
	return toIncidentView(await getRow(db, id));
}
