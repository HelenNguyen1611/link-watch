import type { OutboxKind } from "../db/entities/outbox";
import type { Db } from "../db/index";
import { parseIncidentId } from "../incident";
import {
	GROUP_WINDOW_MS,
	isSystemWideOutage,
	SYSTEM_WIDE_OUTAGE_MIN_CHECKS,
} from "../notify";
import { resolveRecipients } from "../recipients";

const isConditionalFailure = (err: unknown) =>
	/ConditionalCheckFailed|conditional request failed/i.test(
		`${String(err)} ${String((err as { cause?: unknown })?.cause)}`,
	);

/** 5.2 step 5: how far back a system-wide outage run still suppresses domain emails. */
export const OUTAGE_LOOKBACK_MS = 30 * 60_000;

export type OutboxGroupKey = { domain: string; kind: OutboxKind };

export type NotificationEventInput = OutboxGroupKey & {
	incidentId: string;
	/** ISO time the incident was opened (down) or closed (recovery). */
	at: string;
};

/**
 * PLAN Q3 / FR-22: stores the event in the domain outbox. Returns `flushAt` when this
 * event opened a new 5-minute window — the caller then queues one delayed flush.
 */
export async function addToOutbox(
	db: Db,
	event: NotificationEventInput,
): Promise<{ flushAt?: string }> {
	await db.Outbox.put(event).go();
	try {
		await db.OutboxWindow.create({
			domain: event.domain,
			kind: event.kind,
			windowStart: event.at,
		}).go();
	} catch (err) {
		if (isConditionalFailure(err)) return {};
		throw err;
	}
	return {
		flushAt: new Date(Date.parse(event.at) + GROUP_WINDOW_MS).toISOString(),
	};
}

export type TakenOutbox = {
	incidentIds: string[];
	/** Deletes exactly the rows that were read (rows added meanwhile stay for the next window). */
	done: () => Promise<void>;
};

/**
 * PLAN Q3: closes the window first (a new event now opens the next window and queues its
 * own flush), then reads every event of the group.
 */
export async function takeOutbox(
	db: Db,
	key: OutboxGroupKey,
): Promise<TakenOutbox> {
	await db.OutboxWindow.delete(key).go();
	const { data } = await db.Outbox.query.byGroup(key).go({ pages: "all" });
	const incidentIds = [...new Set(data.map((row) => row.incidentId))];
	return {
		incidentIds,
		done: async () => {
			if (data.length === 0) return;
			await db.Outbox.delete(
				data.map((row) => ({
					domain: row.domain,
					kind: row.kind,
					at: row.at,
					incidentId: row.incidentId,
				})),
			).go();
		},
	};
}

/** Reads incidents by id; unknown ids are dropped. */
export async function loadIncidents(db: Db, incidentIds: readonly string[]) {
	if (incidentIds.length === 0) return [];
	const { data } = await db.Incident.get(
		incidentIds.map((id) => parseIncidentId(id)),
	).go();
	return data;
}

/**
 * FR-20: recipients of one link = (link ∪ domain recipients, else the default admin email)
 * ∪ the users with alerts switched on.
 */
export async function recipientsForLink(
	db: Db,
	link: { domain: string; linkId: string },
	{
		defaultAdminEmail,
		alertEmails = [],
	}: { defaultAdminEmail?: string; alertEmails?: readonly string[] } = {},
): Promise<string[]> {
	const [linkRcp, domainRcp] = await Promise.all([
		db.Recipient.query.byTarget({ scope: "LINK", target: link.linkId }).go(),
		db.Recipient.query.byTarget({ scope: "DOMAIN", target: link.domain }).go(),
	]);
	return resolveRecipients({
		linkRecipients: linkRcp.data.map((r) => r.email),
		domainRecipients: domainRcp.data.map((r) => r.email),
		defaultAdminEmail,
		alertEmails,
	});
}

/** 5.2 step 5 + PLAN Q4: the Dispatcher records runs large enough for the 80% rule. */
export async function recordTick(
	db: Db,
	dispatchedAt: string,
	checked: number,
): Promise<void> {
	if (checked < SYSTEM_WIDE_OUTAGE_MIN_CHECKS) return;
	await db.Tick.put({ dispatchedAt, checked }).go();
}

/** 5.2 step 5: the Checker counts a failed scheduled check; small runs have no tick and are ignored. */
export async function addTickFailure(
	db: Db,
	dispatchedAt: string,
): Promise<void> {
	try {
		await db.Tick.update({ dispatchedAt })
			.add({ failed: 1 })
			.where(({ checked }, { exists }) => exists(checked))
			.go();
	} catch (err) {
		if (!isConditionalFailure(err)) throw err;
	}
}

export type OutageTick = {
	dispatchedAt: string;
	checked: number;
	failed: number;
};

/** 5.2 step 5: the most recent run of the last 30 minutes where ≥ 80% of the checks failed. */
export async function findRecentOutage(
	db: Db,
	now: Date,
): Promise<(OutageTick & { adminNotifiedAt?: string }) | undefined> {
	const since = new Date(now.getTime() - OUTAGE_LOOKBACK_MS).toISOString();
	const { data } = await db.Tick.query
		.primary({})
		.gte({ dispatchedAt: since })
		.go({ order: "desc" });
	const tick = data.find((t) =>
		isSystemWideOutage({ checked: t.checked, failed: t.failed ?? 0 }),
	);
	if (!tick) return undefined;
	return {
		dispatchedAt: tick.dispatchedAt,
		checked: tick.checked,
		failed: tick.failed ?? 0,
		...(tick.adminNotifiedAt && { adminNotifiedAt: tick.adminNotifiedAt }),
	};
}

/** 5.2 step 5: claims the single admin email of an outage run; false if already sent. */
export async function claimOutageNotice(
	db: Db,
	dispatchedAt: string,
	now: Date,
): Promise<boolean> {
	try {
		await db.Tick.patch({ dispatchedAt })
			.set({ adminNotifiedAt: now.toISOString() })
			.where(({ adminNotifiedAt }, { notExists }) => notExists(adminNotifiedAt))
			.go();
		return true;
	} catch (err) {
		if (isConditionalFailure(err)) return false;
		throw err;
	}
}
