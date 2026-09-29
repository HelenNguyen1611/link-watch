import { describe, expect, it } from "vitest";
import { CheckJob, MAX_LINKS_PER_JOB } from "./queue";

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
