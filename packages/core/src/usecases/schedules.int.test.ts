import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../db/testing";
import { DomainNotFoundError, updateDomain } from "./domains";
import { createLink, getLink, setPaused, updateLink } from "./links";
import {
	createSchedule,
	deleteSchedule,
	listSchedules,
	updateSchedule,
} from "./schedule-admin";
import {
	DefaultScheduleError,
	ScheduleInUseError,
	ScheduleNotFoundError,
} from "./schedules";

let t: TestDb;
beforeAll(async () => {
	t = await createTestDb();
});
afterAll(() => t?.drop());

// Wednesday 30/09/2026 10:02 Vietnam time.
const NOW = new Date("2026-09-30T03:02:00.000Z");
const minutesUntil = (iso: string | undefined) =>
	(Date.parse(iso ?? "") - NOW.getTime()) / 60_000;

describe("schedules — FR-11, FR-12", () => {
	it("FR-11: the default schedule is always listed (06:00 daily until edited)", async () => {
		const list = await listSchedules(t.db);
		expect(list[0]).toMatchObject({
			id: "default",
			rule: { kind: "daily", at: "06:00" },
		});
	});

	it("FR-12: create, rename, list with usage; invalid rules refused", async () => {
		const s = await createSchedule(
			t.db,
			{ name: "Every 15 min", rule: { kind: "interval", minutes: 15 } },
			{ now: NOW },
		);
		await updateSchedule(t.db, s.id, { name: "Quarter-hourly" }, { now: NOW });
		const list = await listSchedules(t.db);
		expect(list.find((x) => x.id === s.id)).toMatchObject({
			name: "Quarter-hourly",
			usedBy: { domains: 0, links: 0 },
		});
		await expect(
			createSchedule(t.db, {
				name: "x",
				rule: { kind: "interval", minutes: 2 },
			}),
		).rejects.toThrow();
		await expect(
			updateSchedule(t.db, "NOPE", { name: "x" }),
		).rejects.toBeInstanceOf(ScheduleNotFoundError);
	});

	it("FR-11: editing the default schedule creates it and reschedules links that inherit it", async () => {
		const l = await createLink(
			t.db,
			{ url: "https://def-sched.vn/a" },
			{ now: NOW },
		);
		await updateSchedule(
			t.db,
			"default",
			{ rule: { kind: "interval", minutes: 30 } },
			{ now: NOW },
		);
		const after = await getLink(t.db, l.id);
		// Its own slot in the current or next half hour (boundary + jitter ≤ 5 min), not 06:00 tomorrow.
		expect(minutesUntil(after.nextRunAt)).toBeGreaterThan(0);
		expect(minutesUntil(after.nextRunAt)).toBeLessThanOrEqual(35);
		await updateSchedule(
			t.db,
			"default",
			{ rule: { kind: "daily", at: "06:00" } },
			{ now: NOW },
		);
	});
});

describe("schedule assignment — FR-13", () => {
	it("FR-13: a domain schedule reschedules its links that have no own schedule", async () => {
		const every15 = await createSchedule(
			t.db,
			{ name: "15", rule: { kind: "interval", minutes: 15 } },
			{ now: NOW },
		);
		const a = await createLink(
			t.db,
			{ url: "https://assign.vn/a" },
			{ now: NOW },
		);
		const b = await createLink(
			t.db,
			{ url: "https://assign.vn/b" },
			{ now: NOW },
		);
		const weekly = await createSchedule(
			t.db,
			{ name: "Mon", rule: { kind: "weekly", days: [1], at: "08:00" } },
			{ now: NOW },
		);
		await updateLink(t.db, b.id, { scheduleId: weekly.id }, { now: NOW });
		// Link b now waits for Monday 05/10 08:00.
		expect(minutesUntil((await getLink(t.db, b.id)).nextRunAt)).toBeGreaterThan(
			4 * 24 * 60,
		);

		await updateDomain(
			t.db,
			"assign.vn",
			{ scheduleId: every15.id },
			{ now: NOW },
		);
		expect(
			minutesUntil((await getLink(t.db, a.id)).nextRunAt),
		).toBeLessThanOrEqual(18);
		// b keeps its own weekly schedule (Link > Domain).
		expect(minutesUntil((await getLink(t.db, b.id)).nextRunAt)).toBeGreaterThan(
			4 * 24 * 60,
		);

		// Back to inheriting: b follows the domain again.
		await updateLink(t.db, b.id, { scheduleId: null }, { now: NOW });
		const bAfter = await getLink(t.db, b.id);
		expect(bAfter.scheduleId).toBeUndefined();
		expect(minutesUntil(bAfter.nextRunAt)).toBeLessThanOrEqual(18);
	});

	it("FR-12: a template in use cannot be deleted; the default one never", async () => {
		const list = await listSchedules(t.db);
		const used = list.find((s) => (s.usedBy?.domains ?? 0) > 0);
		expect(used).toBeDefined();
		await expect(deleteSchedule(t.db, used?.id ?? "")).rejects.toBeInstanceOf(
			ScheduleInUseError,
		);
		await expect(deleteSchedule(t.db, "default")).rejects.toBeInstanceOf(
			DefaultScheduleError,
		);
		const spare = await createSchedule(t.db, {
			name: "spare",
			rule: { kind: "daily", at: "12:00" },
		});
		await deleteSchedule(t.db, spare.id);
		expect((await listSchedules(t.db)).some((s) => s.id === spare.id)).toBe(
			false,
		);
	});

	it("FR-13: an unknown schedule id is refused; paused links are not rescheduled", async () => {
		const p = await createLink(
			t.db,
			{ url: "https://assign.vn/paused" },
			{ now: NOW },
		);
		await setPaused(t.db, [p.id], true);
		await expect(
			updateLink(t.db, p.id, { scheduleId: "NOPE" }),
		).rejects.toBeInstanceOf(ScheduleNotFoundError);
		await expect(
			updateDomain(t.db, "assign.vn", { scheduleId: "NOPE" }),
		).rejects.toBeInstanceOf(ScheduleNotFoundError);
		expect((await getLink(t.db, p.id)).nextRunAt).toBeUndefined();
	});
});

describe("updateDomain — FR-08, SRS 3.4", () => {
	it("FR-08: edit display name, owner, flags; clear with empty values", async () => {
		await createLink(t.db, { url: "https://meta.vn/" }, { now: NOW });
		const d = await updateDomain(t.db, "meta.vn", {
			displayName: "Meta",
			owner: "Lan@Meta.vn",
			ignoreWaf403: true,
			slowAlert: true,
		});
		expect(d).toMatchObject({
			displayName: "Meta",
			owner: "lan@meta.vn",
			ignoreWaf403: true,
			slowAlert: true,
		});
		const cleared = await updateDomain(t.db, "meta.vn", {
			displayName: "",
			owner: null,
		});
		expect(cleared.displayName).toBeUndefined();
		expect(cleared.owner).toBeUndefined();
		await expect(
			updateDomain(t.db, "nope.vn", { enabled: false }),
		).rejects.toBeInstanceOf(DomainNotFoundError);
		await expect(
			updateDomain(t.db, "meta.vn", { owner: "not-an-email" }),
		).rejects.toThrow();
	});
});
