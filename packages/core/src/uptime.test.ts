import { describe, expect, it } from "vitest";
import { lastDays, summarizeUptime } from "./uptime";

// 30/09/2026 10:00 in Vietnam
const NOW = new Date("2026-09-30T03:00:00.000Z");

describe("summarizeUptime — FR-18", () => {
	it("FR-18: 30 Vietnam days ending today, oldest first", () => {
		const days = lastDays(NOW, 30);
		expect(days).toHaveLength(30);
		expect(days[0]).toBe("2026-09-01");
		expect(days[29]).toBe("2026-09-30");
	});

	it("FR-18: uptime counts up and slow as working; days without checks have no percentage", () => {
		const s = summarizeUptime(
			[
				{
					day: "2026-09-29",
					checks: 4,
					up: 2,
					slow: 1,
					dead: 1,
					totalResponseMs: 1000,
				},
				{ day: "2026-09-30", checks: 1, up: 1, totalResponseMs: 200 },
			],
			NOW,
		);
		expect(s.checks).toBe(5);
		expect(s.uptimePct).toBe(80);
		const d29 = s.days.find((d) => d.day === "2026-09-29");
		expect(d29).toMatchObject({
			checks: 4,
			uptimePct: 75,
			avgResponseMs: 250,
			dead: 1,
		});
		const d01 = s.days[0];
		expect(d01).toEqual({
			day: "2026-09-01",
			checks: 0,
			up: 0,
			slow: 0,
			dead: 0,
			down: 0,
		});
	});

	it("FR-18: no checks at all → no overall percentage", () => {
		const s = summarizeUptime([], NOW, 7);
		expect(s.days).toHaveLength(7);
		expect(s.uptimePct).toBeUndefined();
	});

	it("rows outside the window are ignored", () => {
		const s = summarizeUptime([{ day: "2026-08-01", checks: 10, up: 0 }], NOW);
		expect(s.checks).toBe(0);
	});
});
