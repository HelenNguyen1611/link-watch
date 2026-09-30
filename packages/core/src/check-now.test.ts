import { describe, expect, it } from "vitest";
import { planCheckNow } from "./check-now";
import { CheckJob } from "./queue";

const NOW = new Date("2026-09-30T03:00:00.000Z");

describe("planCheckNow — FR-16", () => {
	it("FR-16: one check_now job per domain, valid for the Checker", () => {
		const plan = planCheckNow(
			["a1", "b1", "a2"],
			[
				{ id: "a1", domain: "abc.com" },
				{ id: "a2", domain: "abc.com" },
				{ id: "b1", domain: "xyz.vn" },
			],
			NOW,
		);
		expect(plan.jobs).toEqual([
			{
				kind: "check_now",
				domain: "abc.com",
				linkIds: ["a1", "a2"],
				dueAt: NOW.toISOString(),
			},
			{
				kind: "check_now",
				domain: "xyz.vn",
				linkIds: ["b1"],
				dueAt: NOW.toISOString(),
			},
		]);
		for (const job of plan.jobs)
			expect(CheckJob.safeParse(job).success).toBe(true);
		expect(plan.queued).toEqual(["a1", "a2", "b1"]);
		expect(plan.skipped).toEqual([]);
	});

	it("FR-14: at most 20 links per job", () => {
		const links = Array.from({ length: 45 }, (_, i) => ({
			id: `L${i}`,
			domain: "abc.com",
		}));
		const plan = planCheckNow(
			links.map((l) => l.id),
			links,
			NOW,
		);
		expect(plan.jobs.map((j) => j.linkIds.length)).toEqual([20, 20, 5]);
	});

	it("FR-04: paused, deleted and unknown links are skipped; duplicates count once", () => {
		const plan = planCheckNow(
			["p", "d", "x", "ok", "ok"],
			[
				{ id: "p", domain: "abc.com", paused: true },
				{ id: "d", domain: "abc.com", deletedAt: "2026-09-29T00:00:00.000Z" },
				{ id: "ok", domain: "abc.com" },
			],
			NOW,
		);
		expect(plan.queued).toEqual(["ok"]);
		expect(plan.skipped).toEqual([
			{ id: "p", reason: "paused" },
			{ id: "d", reason: "not_found" },
			{ id: "x", reason: "not_found" },
		]);
	});
});
