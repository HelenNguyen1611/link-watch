import { describe, expect, it } from "vitest";
import {
	DEFAULT_REMINDER_INTERVAL_MS,
	groupIncidents,
	isReminderDue,
	isSystemWideOutage,
	type NotificationEvent,
	type ReminderState,
} from "./notify";

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = Date.parse("2026-09-29T23:04:00.000Z");
const at = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

type Event = NotificationEvent & { linkId: string };
const event = (
	linkId: string,
	offsetMs: number,
	partial: Partial<Event> = {},
): Event => ({
	kind: "down",
	domain: "abc.com",
	at: at(offsetMs),
	linkId,
	...partial,
});

describe("groupIncidents — FR-22", () => {
	it("AC-06: 5 links of the same domain down together → 1 group listing 5 links", () => {
		const events = [0, 1, 2, 3, 4].map((i) => event(`L${i}`, i * 30_000));
		const groups = groupIncidents(events);
		expect(groups).toHaveLength(1);
		expect(groups[0]?.events.map((e) => e.linkId)).toEqual([
			"L0",
			"L1",
			"L2",
			"L3",
			"L4",
		]);
		expect(groups[0]?.domain).toBe("abc.com");
	});

	it("FR-22: the group is sent 5 minutes after its first event (PLAN Q3)", () => {
		const [group] = groupIncidents([event("L1", 2 * MIN), event("L2", 0)]);
		expect(group?.windowStart).toBe(at(0));
		expect(group?.sendAt).toBe(at(5 * MIN));
		expect(group?.events.map((e) => e.linkId)).toEqual(["L2", "L1"]);
	});

	it("FR-22: an event exactly 5 minutes after the first starts a new group", () => {
		const groups = groupIncidents([
			event("L1", 0),
			event("L2", 5 * MIN - 1),
			event("L3", 5 * MIN),
		]);
		expect(groups.map((g) => g.events.map((e) => e.linkId))).toEqual([
			["L1", "L2"],
			["L3"],
		]);
	});

	it("FR-22: different domains are never grouped together", () => {
		const groups = groupIncidents([
			event("L1", 0),
			event("L2", MIN, { domain: "xyz.com" }),
		]);
		expect(groups.map((g) => g.domain)).toEqual(["abc.com", "xyz.com"]);
	});

	it("FR-21: incident and recovery events of one domain go into separate emails", () => {
		const groups = groupIncidents([
			event("L1", 0),
			event("L2", MIN, { kind: "recovery" }),
		]);
		expect(groups.map((g) => g.kind)).toEqual(["down", "recovery"]);
	});

	it("FR-22: no events → no groups", () => {
		expect(groupIncidents([])).toEqual([]);
	});
});

describe("isReminderDue — FR-23", () => {
	const incident = (partial: Partial<ReminderState> = {}): ReminderState => ({
		state: "open",
		openedAt: at(0),
		acknowledged: false,
		...partial,
	});
	const nowAt = (offsetMs: number) => new Date(T0 + offsetMs);

	it("FR-23: open and unacknowledged for 24 hours → reminder due (default interval)", () => {
		expect(
			isReminderDue(incident(), DEFAULT_REMINDER_INTERVAL_MS, nowAt(24 * HOUR)),
		).toBe(true);
	});

	it("FR-23: before 24 hours → not due", () => {
		expect(
			isReminderDue(
				incident(),
				DEFAULT_REMINDER_INTERVAL_MS,
				nowAt(24 * HOUR - 1),
			),
		).toBe(false);
	});

	it("FR-23: counts from the last reminder, not from opening", () => {
		const inc = incident({ lastReminderAt: at(24 * HOUR) });
		expect(
			isReminderDue(inc, DEFAULT_REMINDER_INTERVAL_MS, nowAt(30 * HOUR)),
		).toBe(false);
		expect(
			isReminderDue(inc, DEFAULT_REMINDER_INTERVAL_MS, nowAt(48 * HOUR)),
		).toBe(true);
	});

	it("FR-23: acknowledged → never due", () => {
		expect(
			isReminderDue(
				incident({ acknowledged: true }),
				DEFAULT_REMINDER_INTERVAL_MS,
				nowAt(72 * HOUR),
			),
		).toBe(false);
	});

	it("FR-23: closed incident → never due", () => {
		expect(
			isReminderDue(
				incident({ state: "closed" }),
				DEFAULT_REMINDER_INTERVAL_MS,
				nowAt(72 * HOUR),
			),
		).toBe(false);
	});

	it("FR-23: a verifying incident is still open → due", () => {
		expect(
			isReminderDue(
				incident({ state: "verifying" }),
				DEFAULT_REMINDER_INTERVAL_MS,
				nowAt(24 * HOUR),
			),
		).toBe(true);
	});

	it("FR-23: configurable interval", () => {
		expect(isReminderDue(incident(), 6 * HOUR, nowAt(6 * HOUR))).toBe(true);
	});

	it("FR-23: reminders disabled (null interval) → never due", () => {
		expect(isReminderDue(incident(), null, nowAt(72 * HOUR))).toBe(false);
	});
});

describe("isSystemWideOutage — SRS 5.2 step 5", () => {
	it("5.2: ≥ 80% of a run failing → system-wide outage", () => {
		expect(isSystemWideOutage({ checked: 100, failed: 80 })).toBe(true);
		expect(isSystemWideOutage({ checked: 100, failed: 100 })).toBe(true);
	});

	it("5.2: below 80% → normal per-domain emails", () => {
		expect(isSystemWideOutage({ checked: 100, failed: 79 })).toBe(false);
	});

	it("5.2: runs with fewer than 20 checks never count (PLAN Q4)", () => {
		expect(isSystemWideOutage({ checked: 19, failed: 19 })).toBe(false);
		expect(isSystemWideOutage({ checked: 20, failed: 16 })).toBe(true);
	});
});
