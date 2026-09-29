import { describe, expect, it } from "vitest";
import {
	applyJitter,
	computeNextRun,
	DEFAULT_SCHEDULE,
	JITTER_MAX_MS,
	localDay,
	nextRunAt,
} from "./schedule";

const utc = (s: string) => new Date(s);

describe("computeNextRun — daily schedule", () => {
	it("FR-11: the default schedule is daily at 06:00 Asia/Saigon", () => {
		expect(DEFAULT_SCHEDULE).toEqual({ kind: "daily", at: "06:00" });
	});

	it("FR-11: before 06:00 → 06:00 the same day (06:00 +07:00 = 23:00 UTC the day before)", () => {
		// 05:30 on 30/09, Vietnam time
		expect(
			computeNextRun(
				DEFAULT_SCHEDULE,
				utc("2026-09-29T22:30:00Z"),
			).toISOString(),
		).toBe("2026-09-29T23:00:00.000Z");
	});

	it("FR-11: after 06:00 → 06:00 the next day (day rollover)", () => {
		// 07:00 on 30/09, Vietnam time
		expect(
			computeNextRun(
				DEFAULT_SCHEDULE,
				utc("2026-09-30T00:00:00Z"),
			).toISOString(),
		).toBe("2026-09-30T23:00:00.000Z");
	});

	it("FR-11: exactly 06:00 → the next run is the next day (always after now)", () => {
		expect(
			computeNextRun(
				DEFAULT_SCHEDULE,
				utc("2026-09-29T23:00:00Z"),
			).toISOString(),
		).toBe("2026-09-30T23:00:00.000Z");
	});

	it("FR-11: month and year rollover", () => {
		// 23:59 on 30/09 Vietnam time → 06:00 on 01/10
		expect(
			computeNextRun(
				DEFAULT_SCHEDULE,
				utc("2026-09-30T16:59:00Z"),
			).toISOString(),
		).toBe("2026-09-30T23:00:00.000Z");
		// 12:00 on 31/12 Vietnam time → 06:00 on 01/01 next year
		expect(
			computeNextRun(
				DEFAULT_SCHEDULE,
				utc("2026-12-31T05:00:00Z"),
			).toISOString(),
		).toBe("2026-12-31T23:00:00.000Z");
	});

	it("FR-11: when the Admin changes the default time (e.g. 07:30) the new time is used", () => {
		expect(
			computeNextRun(
				{ kind: "daily", at: "07:30" },
				utc("2026-09-29T22:30:00Z"),
			).toISOString(),
		).toBe("2026-09-30T00:30:00.000Z");
	});

	it.each(["6:00", "24:00", "06:60", "0600", ""])(
		"FR-11: invalid time is rejected: %j",
		(at) => {
			expect(() => computeNextRun({ kind: "daily", at }, new Date())).toThrow();
		},
	);
});

describe("applyJitter", () => {
	const base = utc("2026-09-29T23:00:00Z");

	it("FR-14: offset within [0, 5 min)", () => {
		for (let i = 0; i < 500; i++) {
			const d = applyJitter(base, `link_${i}`).getTime() - base.getTime();
			expect(d).toBeGreaterThanOrEqual(0);
			expect(d).toBeLessThan(JITTER_MAX_MS);
		}
		expect(JITTER_MAX_MS).toBe(5 * 60_000);
	});

	it("FR-14: the same link id always gets the same offset (stable across runs)", () => {
		expect(applyJitter(base, "abc").getTime()).toBe(
			applyJitter(base, "abc").getTime(),
		);
		const other = utc("2026-10-05T23:00:00Z");
		expect(applyJitter(other, "abc").getTime() - other.getTime()).toBe(
			applyJitter(base, "abc").getTime() - base.getTime(),
		);
	});

	it("FR-14: spreads links scheduled for the same time (each of the 5 minutes gets 15–25% of links)", () => {
		const buckets = [0, 0, 0, 0, 0];
		const n = 5000;
		for (let i = 0; i < n; i++) {
			const d =
				applyJitter(base, `01J${i.toString(36).padStart(8, "0")}`).getTime() -
				base.getTime();
			buckets[Math.floor(d / 60_000)]++;
		}
		for (const b of buckets) {
			expect(b / n).toBeGreaterThan(0.15);
			expect(b / n).toBeLessThan(0.25);
		}
	});
});

describe("nextRunAt", () => {
	it("AC-02: link and domain without their own schedule → next run within 06:00–06:05", () => {
		// The Dispatcher runs every 5 minutes, so the link is picked up before 06:10 and checked before 06:15.
		const now = utc("2026-09-29T10:00:00Z"); // 17:00 Vietnam time
		for (const id of ["a", "b", "c", "01JABCDEF", "link-9999"]) {
			const t = nextRunAt(DEFAULT_SCHEDULE, id, now).getTime();
			const six = utc("2026-09-29T23:00:00Z").getTime();
			expect(t).toBeGreaterThanOrEqual(six);
			expect(t).toBeLessThan(six + JITTER_MAX_MS);
		}
	});

	it("AC-02: link just checked at 06:03 (with jitter) → next run is the next morning", () => {
		const checkedAt = utc("2026-09-29T23:03:00Z");
		const t = nextRunAt(DEFAULT_SCHEDULE, "a", checkedAt);
		expect(t.getTime()).toBeGreaterThanOrEqual(
			utc("2026-09-30T23:00:00Z").getTime(),
		);
		expect(t.getTime()).toBeLessThan(utc("2026-09-30T23:05:00Z").getTime());
	});
});

describe("localDay — NFR-08", () => {
	it("NFR-08: the day follows Asia/Saigon, not UTC", () => {
		expect(localDay(new Date("2026-09-29T16:59:59.999Z"))).toBe("2026-09-29");
		expect(localDay(new Date("2026-09-29T17:00:00.000Z"))).toBe("2026-09-30");
	});
});
