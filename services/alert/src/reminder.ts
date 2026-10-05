import { isReminderDue } from "@linkwatch/core";
import { DEFAULT_REMINDER_INTERVAL_HOURS } from "@linkwatch/core/db";
import {
	closeIncidentsOfDeletedLink,
	findDeletedLinkIds,
} from "@linkwatch/core/usecases";
import { renderReminderEmail } from "@linkwatch/emails";
import {
	type AlertDeps,
	type Incident,
	markIncidents,
	resolveSender,
	sendGrouped,
	toIncidentItem,
} from "./outbox";

const HOUR_MS = 60 * 60_000;

/** Incidents not closed yet: Open and Verifying (GSI2). */
async function activeIncidents(deps: AlertDeps): Promise<Incident[]> {
	const [open, verifying] = await Promise.all(
		(["open", "verifying"] as const).map((state) =>
			deps.db.Incident.query.byState({ state }).go({ pages: "all" }),
		),
	);
	return [...(open?.data ?? []), ...(verifying?.data ?? [])];
}

/**
 * FR-23: every run (EventBridge Scheduler), remind recipients of incidents that are still
 * open, not acknowledged and were announced by an incident email, once per interval.
 * One email per domain and recipient; `lastReminderAt` is set even when sending fails,
 * so a broken address is retried next interval instead of every run (the failure is logged, FR-25).
 * FR-04: an incident whose link was deleted is closed instead of reminded (incidents left
 * open by deletions made before deleting closed them).
 */
export async function sendReminders(
	deps: AlertDeps,
	now: Date,
): Promise<number> {
	const { data: settings } = await deps.db.Settings.get({}).go();
	if (settings?.remindersEnabled === false) return 0;
	const hours =
		settings?.reminderIntervalHours ?? DEFAULT_REMINDER_INTERVAL_HOURS;

	const candidates = (await activeIncidents(deps)).filter(
		(i) =>
			i.downNotifiedAt &&
			isReminderDue(
				{
					state: i.state,
					openedAt: i.openedAt,
					acknowledged: Boolean(i.ackedAt),
					...(i.lastReminderAt && { lastReminderAt: i.lastReminderAt }),
				},
				hours * HOUR_MS,
				now,
			),
	);
	const deleted = await findDeletedLinkIds(
		deps.db,
		candidates.map((i) => i.linkId),
	);
	for (const linkId of deleted) {
		const closed = await closeIncidentsOfDeletedLink(deps.db, linkId, { now });
		deps.log?.("Closed incidents of a deleted link", { linkId, closed });
	}
	const due = candidates.filter((i) => !deleted.has(i.linkId));
	if (due.length === 0) return 0;

	const sender = await resolveSender(deps);
	const byDomain = new Map<string, Incident[]>();
	for (const i of due)
		byDomain.set(i.domain, [...(byDomain.get(i.domain) ?? []), i]);

	for (const [domain, incidents] of byDomain) {
		await sendGrouped(
			deps,
			sender,
			incidents,
			"reminder",
			(items) =>
				renderReminderEmail({
					domain,
					appUrl: deps.config.appUrl,
					items: items.map(toIncidentItem),
					intervalHours: hours,
					now: now.toISOString(),
				}),
			now,
		);
		await markIncidents(deps, incidents, { lastReminderAt: now.toISOString() });
	}
	return due.length;
}
