/** FR-22: incidents of one domain raised within this window go into one email. */
export const GROUP_WINDOW_MS = 5 * 60_000;
/** FR-23: default reminder interval for an open, unacknowledged incident. */
export const DEFAULT_REMINDER_INTERVAL_MS = 24 * 60 * 60_000;
/** SRS 5.2 step 5: share of failing links in one run that means a LinkWatch-side network problem. */
export const SYSTEM_WIDE_OUTAGE_RATIO = 0.8;
/** PLAN Q4: the 80% rule only applies to a Dispatcher tick with at least this many checks. */
export const SYSTEM_WIDE_OUTAGE_MIN_CHECKS = 20;

/** FR-21: incident email (open) or recovery email (close). Reminders are not grouped. */
export type NotificationKind = "down" | "recovery";

export type NotificationEvent = {
	kind: NotificationKind;
	domain: string;
	/** ISO 8601 UTC time the incident was opened or closed. */
	at: string;
};

export type NotificationGroup<T extends NotificationEvent> = {
	kind: NotificationKind;
	domain: string;
	/** Time of the first event in the group. */
	windowStart: string;
	/** PLAN Q3: when the grouped email is sent = windowStart + GROUP_WINDOW_MS. */
	sendAt: string;
	events: T[];
};

/**
 * FR-22: group events by domain and kind; a group starts at its first event and takes
 * every later event of the same domain and kind until `windowStart + windowMs` (exclusive).
 * Groups are returned ordered by `windowStart`, events inside a group by time.
 */
export function groupIncidents<T extends NotificationEvent>(
	events: readonly T[],
	windowMs: number = GROUP_WINDOW_MS,
): NotificationGroup<T>[] {
	const sorted = [...events].sort(
		(a, b) => Date.parse(a.at) - Date.parse(b.at),
	);
	const open = new Map<string, NotificationGroup<T>>();
	const groups: NotificationGroup<T>[] = [];

	for (const event of sorted) {
		const key = `${event.kind}\u0000${event.domain}`;
		const current = open.get(key);
		if (current && Date.parse(event.at) < Date.parse(current.sendAt)) {
			current.events.push(event);
			continue;
		}
		const start = Date.parse(event.at);
		const group: NotificationGroup<T> = {
			kind: event.kind,
			domain: event.domain,
			windowStart: new Date(start).toISOString(),
			sendAt: new Date(start + windowMs).toISOString(),
			events: [event],
		};
		open.set(key, group);
		groups.push(group);
	}
	return groups;
}

export type ReminderState = {
	state: "open" | "verifying" | "closed";
	openedAt: string;
	acknowledged: boolean;
	/** Last reminder sent; undefined → none yet, count from `openedAt`. */
	lastReminderAt?: string;
};

/**
 * FR-23: a reminder is due when the incident is still not closed, not acknowledged,
 * reminders are enabled (`intervalMs` not null) and one interval has passed since
 * the last reminder (or since the incident was opened).
 */
export function isReminderDue(
	incident: ReminderState,
	intervalMs: number | null,
	now: Date,
): boolean {
	if (intervalMs === null || intervalMs <= 0) return false;
	if (incident.state === "closed" || incident.acknowledged) return false;
	const since = Date.parse(incident.lastReminderAt ?? incident.openedAt);
	return now.getTime() - since >= intervalMs;
}

/**
 * SRS 5.2 step 5 + PLAN Q4: ≥ 80% of the checks in one Dispatcher tick failed →
 * treat it as a LinkWatch-side network problem (only one email to the admin).
 * Ticks with fewer than 20 checks never count.
 */
export function isSystemWideOutage(run: {
	checked: number;
	failed: number;
}): boolean {
	if (run.checked < SYSTEM_WIDE_OUTAGE_MIN_CHECKS) return false;
	return run.failed >= run.checked * SYSTEM_WIDE_OUTAGE_RATIO;
}
