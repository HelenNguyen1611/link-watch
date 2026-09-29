import { describe, expect, it } from "vitest";
import {
	CheckJob,
	MAX_DELAY_SECONDS,
	MAX_LINKS_PER_JOB,
	planNextRun,
} from "./queue";

describe("CheckJob", () => {
	it("FR-14: one domain per message, at most 20 links", () => {
		expect(MAX_LINKS_PER_JOB).toBe(20);
		const job = {
			kind: "scheduled",
			domain: "abc.com",
			linkIds: ["a", "b"],
			dispatchedAt: "2026-09-29T23:00:00.000Z",
		};
		expect(CheckJob.parse(job)).toEqual(job);
		expect(CheckJob.safeParse({ ...job, linkIds: [] }).success).toBe(false);
		expect(
			CheckJob.safeParse({
				...job,
				linkIds: Array.from({ length: 21 }, (_, i) => `l${i}`),
			}).success,
		).toBe(false);
		expect(CheckJob.safeParse({ ...job, kind: "other" }).success).toBe(false);
	});
});

describe("CheckJob — priority jobs (PLAN Q2)", () => {
	const recheck = {
		kind: "recheck",
		domain: "abc.com",
		linkIds: ["a"],
		dueAt: "2026-09-29T23:04:00.000Z",
	};

	it("5.2: accepts recheck, check_now and verify jobs", () => {
		expect(CheckJob.parse(recheck)).toEqual(recheck);
		expect(CheckJob.parse({ ...recheck, kind: "check_now" }).kind).toBe(
			"check_now",
		);
		expect(
			CheckJob.parse({ ...recheck, kind: "verify", attempt: 2 }),
		).toMatchObject({ kind: "verify", attempt: 2 });
	});

	it("FR-37: at most 3 verification attempts", () => {
		expect(
			CheckJob.safeParse({ ...recheck, kind: "verify", attempt: 4 }).success,
		).toBe(false);
	});

	it("FR-14: a priority job without dueAt is rejected", () => {
		const { dueAt: _, ...rest } = recheck;
		expect(CheckJob.safeParse(rest).success).toBe(false);
	});
});

describe("planNextRun — PLAN Q2", () => {
	const now = new Date("2026-09-29T23:02:00.000Z");
	const plus = (ms: number) => new Date(now.getTime() + ms);

	it("5.2 step 1: recheck in 2 minutes → delay 120 s, next_run_at fallback 5 minutes later", () => {
		expect(planNextRun(plus(2 * 60_000), now)).toEqual({
			delaySeconds: 120,
			storedNextRunAt: plus(7 * 60_000),
		});
	});

	it("5.2 step 3: recheck in 10 minutes → delay 600 s", () => {
		expect(planNextRun(plus(10 * 60_000), now).delaySeconds).toBe(600);
	});

	it("SQS limit: exactly 15 minutes is still delayed, beyond is left to the Dispatcher", () => {
		expect(planNextRun(plus(15 * 60_000), now).delaySeconds).toBe(
			MAX_DELAY_SECONDS,
		);
		expect(planNextRun(plus(24 * 3_600_000), now)).toEqual({
			storedNextRunAt: plus(24 * 3_600_000),
		});
	});
});
