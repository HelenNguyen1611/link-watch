import type { Db } from "../db/index";
import { DomainUpdate } from "../schema/domain";
import { rescheduleLinks } from "./reschedule";
import { assertScheduleExists } from "./schedule-admin";

export class DomainNotFoundError extends Error {
	readonly code = "not_found";
	constructor(readonly name: string) {
		super(`Domain not found: ${name}`);
		this.name = "DomainNotFoundError";
	}
}

export async function getDomainRow(db: Db, name: string) {
	const { data } = await db.Domain.get({ name }).go();
	if (!data) throw new DomainNotFoundError(name);
	return data;
}

/**
 * FR-08 / FR-13 / SRS 3.4: edit a domain. A new schedule reschedules its links that have
 * no schedule of their own.
 */
export async function updateDomain(
	db: Db,
	name: string,
	raw: unknown,
	{ now = new Date() }: { now?: Date } = {},
) {
	const input = DomainUpdate.parse(raw);
	const current = await getDomainRow(db, name);
	if (input.scheduleId) await assertScheduleExists(db, input.scheduleId);
	const set: Record<string, unknown> = {};
	const remove: ("displayName" | "description" | "owner" | "scheduleId")[] = [];
	for (const [k, v] of Object.entries(input))
		if (v === null) remove.push(k as (typeof remove)[number]);
		else set[k] = v;
	let patch = db.Domain.patch({ name }).set(set);
	if (remove.length) patch = patch.remove(remove) as typeof patch;
	await patch.go();

	if (
		"scheduleId" in input &&
		(input.scheduleId ?? undefined) !== current.scheduleId
	) {
		const { data: links } = await db.Link.query
			.primary({ domain: name })
			.go({ pages: "all" });
		await rescheduleLinks(
			db,
			links.filter((l) => !l.scheduleId),
			{ now },
		);
	}
	return getDomainRow(db, name);
}
