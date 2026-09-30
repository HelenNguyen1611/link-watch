import { describe, expect, it } from "vitest";
import {
	computeNextRun,
	DEFAULT_SCHEDULE,
	nextRunAt,
	resolveEffectiveSchedule,
	type Schedule,
} from "./schedule";
import { ScheduleRule } from "./schema/schedule";

/** Vietnam local time "YYYY-MM-DDTHH:mm" → Date. */
const vn = (s: string) => new Date(`${s}:00.000+07:00`);
const next = (rule: Schedule, after: string) =>
	computeNextRun(rule, vn(after)).toISOString();

describe("ScheduleRule — FR-12", () => {
	it("FR-12: intervals 5/15/30 min and 1/6/12 h only; minimum 5 minutes", () => {
		expect(
			ScheduleRule.safeParse({ kind: "interval", minutes: 15 }).success,
		).toBe(true);
		expect(
			ScheduleRule.safeParse({ kind: "interval", minutes: 720 }).success,
		).toBe(true);
		expect(
			ScheduleRule.safeParse({ kind: "interval", minutes: 1 }).success,
		).toBe(false);
		expect(
			ScheduleRule.safeParse({ kind: "interval", minutes: 10 }).success,
		).toBe(false);
	});

	it("FR-12: weekly / monthly days are deduplicated and sorted; bad values refused", () => {
		expect(
			ScheduleRule.parse({ kind: "weekly", days: [5, 1, 5], at: "08:00" }),
		).toEqual({
			kind: "weekly",
			days: [1, 5],
			at: "08:00",
		});
		expect(
			ScheduleRule.safeParse({ kind: "weekly", days: [8], at: "08:00" })
				.success,
		).toBe(false);
		expect(
			ScheduleRule.safeParse({ kind: "monthly", days: [], at: "08:00" })
				.success,
		).toBe(false);
		expect(ScheduleRule.safeParse({ kind: "daily", at: "24:00" }).success).toBe(
			false,
		);
	});
});

describe("computeNextRun — FR-12", () => {
	it("FR-12: interval runs on local wall-clock multiples", () => {
		expect(next({ kind: "interval", minutes: 15 }, "2026-09-30T06:07")).toBe(
			vn("2026-09-30T06:15").toISOString(),
		);
		expect(next({ kind: "interval", minutes: 15 }, "2026-09-30T06:15")).toBe(
			vn("2026-09-30T06:30").toISOString(),
		);
		expect(next({ kind: "interval", minutes: 360 }, "2026-09-30T13:00")).toBe(
			vn("2026-09-30T18:00").toISOString(),
		);
		expect(next({ kind: "interval", minutes: 720 }, "2026-09-30T23:59")).toBe(
			vn("2026-10-01T00:00").toISOString(),
		);
	});

	it("FR-12: daily at a fixed time (today if still ahead, else tomorrow)", () => {
		expect(next({ kind: "daily", at: "08:30" }, "2026-09-30T08:00")).toBe(
			vn("2026-09-30T08:30").toISOString(),
		);
		expect(next({ kind: "daily", at: "08:30" }, "2026-09-30T08:30")).toBe(
			vn("2026-10-01T08:30").toISOString(),
		);
	});

	it("FR-12: weekly on chosen weekdays (30/09/2026 is a Wednesday)", () => {
		const rule: Schedule = { kind: "weekly", days: [1, 5], at: "07:00" };
		expect(next(rule, "2026-09-30T10:00")).toBe(
			vn("2026-10-02T07:00").toISOString(),
		); // Friday
		expect(next(rule, "2026-10-02T07:00")).toBe(
			vn("2026-10-05T07:00").toISOString(),
		); // Monday
	});

	it("FR-12: monthly on day 31 → last day of shorter months, once", () => {
		const rule: Schedule = { kind: "monthly", days: [31], at: "09:00" };
		expect(next(rule, "2026-09-01T00:00")).toBe(
			vn("2026-09-30T09:00").toISOString(),
		);
		expect(next(rule, "2026-09-30T09:00")).toBe(
			vn("2026-10-31T09:00").toISOString(),
		);
		expect(next(rule, "2027-02-01T00:00")).toBe(
			vn("2027-02-28T09:00").toISOString(),
		);
		expect(next(rule, "2028-02-01T00:00")).toBe(
			vn("2028-02-29T09:00").toISOString(),
		);
	});

	it("FR-12: days 30 and 31 in a 30-day month run only once that month", () => {
		const rule: Schedule = { kind: "monthly", days: [30, 31], at: "09:00" };
		expect(next(rule, "2026-09-30T09:00")).toBe(
			vn("2026-10-30T09:00").toISOString(),
		);
	});
});

describe("nextRunAt — FR-14 jitter", () => {
	it("FR-14: a 5-minute interval keeps every link inside its own 5-minute slot", () => {
		for (const id of ["a", "b", "c", "d", "e", "f"]) {
			const t = nextRunAt(
				{ kind: "interval", minutes: 5 },
				id,
				vn("2026-09-30T06:00"),
			).getTime();
			expect(t).toBeGreaterThan(vn("2026-09-30T06:00").getTime());
			expect(t).toBeLessThanOrEqual(vn("2026-09-30T06:10").getTime());
		}
	});

	it("FR-14: after a check at boundary + jitter, the next run is one interval later", () => {
		const rule: Schedule = { kind: "interval", minutes: 15 };
		const first = nextRunAt(rule, "L1", vn("2026-09-30T06:00"));
		const second = nextRunAt(rule, "L1", first);
		expect(second.getTime() - first.getTime()).toBe(15 * 60_000);
	});
});

describe("resolveEffectiveSchedule — FR-13", () => {
	const templates = new Map<string, Schedule>([
		["default", { kind: "daily", at: "06:00" }],
		["every15", { kind: "interval", minutes: 15 }],
		["weekly", { kind: "weekly", days: [1], at: "08:00" }],
	]);

	it("FR-13: link > domain > default, with the source", () => {
		expect(
			resolveEffectiveSchedule(
				{ scheduleId: "weekly" },
				{ scheduleId: "every15" },
				templates,
			),
		).toMatchObject({
			source: "link",
			scheduleId: "weekly",
		});
		expect(
			resolveEffectiveSchedule({}, { scheduleId: "every15" }, templates),
		).toMatchObject({
			source: "domain",
			scheduleId: "every15",
		});
		expect(resolveEffectiveSchedule({}, {}, templates)).toMatchObject({
			source: "default",
			scheduleId: "default",
		});
	});

	it("FR-13: a deleted template falls through; no default template yet → built-in 06:00", () => {
		expect(
			resolveEffectiveSchedule(
				{ scheduleId: "gone" },
				{ scheduleId: "every15" },
				templates,
			).source,
		).toBe("domain");
		expect(resolveEffectiveSchedule({}, undefined, new Map())).toEqual({
			rule: DEFAULT_SCHEDULE,
			source: "default",
		});
	});
});

describe("AC-03 (function level)", () => {
	it("AC-03: domain every 15 min, one link weekly → in 1 hour the others run 4 times, the weekly one not at all", () => {
		const templates = new Map<string, Schedule>([
			["every15", { kind: "interval", minutes: 15 }],
			["weekly", { kind: "weekly", days: [1], at: "08:00" }],
		]);
		const domain = { scheduleId: "every15" };
		const count = (link: { id: string; scheduleId?: string }) => {
			const rule = resolveEffectiveSchedule(link, domain, templates).rule;
			const start = vn("2026-09-30T10:00").getTime(); // Wednesday
			const end = start + 60 * 60_000;
			let at = nextRunAt(rule, link.id, new Date(start));
			let runs = 0;
			while (at.getTime() <= end) {
				runs++;
				at = nextRunAt(rule, link.id, at);
			}
			return runs;
		};
		expect(count({ id: "other-1" })).toBe(4);
		expect(count({ id: "other-2" })).toBe(4);
		expect(count({ id: "own", scheduleId: "weekly" })).toBe(0);
	});
});
