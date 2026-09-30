import { describe, expect, it } from "vitest";
import { type FeatureSmokeOptions, runFeatureSmoke } from "./smoke-features";

type Scenario = {
	/** Polls before the Check now result shows up; undefined = never. */
	checkedAfter?: number;
	status?: string;
	/** Minutes from now to the next run after the schedule is assigned. */
	nextRunInMin?: number;
};

const T0 = Date.parse("2026-09-30T09:00:00.000Z");

function fakeWorld(s: Scenario = {}) {
	const calls: string[] = [];
	let polls = 0;
	let t = T0;
	const json = (status: number, body?: unknown) =>
		new Response(body === undefined ? null : JSON.stringify(body), { status });
	const link = (over: Record<string, unknown> = {}) => ({
		id: "L1",
		status: "pending",
		...over,
	});
	let deletedLink = false;
	const fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
		const url = new URL(String(input));
		const method = init.method ?? "GET";
		const path = url.pathname;
		calls.push(`${method} ${path}`);
		if (path === "/api/links" && method === "POST") return json(201, link());
		if (path === "/api/links/check-now")
			return json(202, { queued: ["L1"], skipped: [], jobs: 1 });
		if (path === "/api/links/L1" && method === "GET")
			return json(
				200,
				s.checkedAfter !== undefined && polls >= s.checkedAfter
					? link({
							status: s.status ?? "up",
							lastCheckedAt: new Date(t).toISOString(),
							lastHttpCode: 200,
						})
					: link(),
			);
		if (path === "/api/schedules" && method === "POST")
			return json(201, { id: "S1" });
		if (path === "/api/links/L1" && method === "PATCH")
			return json(
				200,
				link({
					scheduleId: "S1",
					nextRunAt: new Date(t + (s.nextRunInMin ?? 6) * 60_000).toISOString(),
				}),
			);
		if (path === "/api/links/L1" && method === "DELETE") {
			deletedLink = true;
			return json(204);
		}
		if (path === "/api/schedules/S1" && method === "DELETE")
			return deletedLink ? json(204) : json(409, { error: "schedule_in_use" });
		return json(404, { error: "not_found" });
	};
	const opts: FeatureSmokeOptions = {
		baseUrl: "https://watch.hueai.net",
		token: "tok",
		runId: "run1",
		fetch: fetch as typeof globalThis.fetch,
		sleep: async (ms) => {
			t += ms;
			polls++;
		},
		now: () => t,
	};
	return { opts, calls };
}

describe("feature smoke test (step 40c)", () => {
	it("FR-16 + FR-13: Check now gives a result, an every-5-minutes schedule moves the next run; cleans up", async () => {
		const w = fakeWorld({ checkedAfter: 2 });
		const report = await runFeatureSmoke(w.opts);
		expect(report.failures).toEqual([]);
		expect(w.calls).toEqual([
			"POST /api/links",
			"POST /api/links/check-now",
			"GET /api/links/L1",
			"GET /api/links/L1",
			"GET /api/links/L1",
			"POST /api/schedules",
			"PATCH /api/links/L1",
			"DELETE /api/schedules/S1",
			"DELETE /api/links/L1",
			"DELETE /api/schedules/S1",
		]);
	});

	it("FR-16: no result within the timeout → fails, still cleans up", async () => {
		const w = fakeWorld({});
		const report = await runFeatureSmoke(w.opts);
		expect(report.failures).toEqual([
			expect.stringContaining("Check now: no result within 120 s"),
		]);
		expect(w.calls.slice(-2)).toEqual([
			"DELETE /api/links/L1",
			"DELETE /api/schedules/S1",
		]);
	});

	it("FR-13: next run still at the daily default → fails", async () => {
		const w = fakeWorld({ checkedAfter: 0, nextRunInMin: 20 * 60 });
		const report = await runFeatureSmoke(w.opts);
		expect(report.failures).toEqual([
			expect.stringContaining("is not within 10 min"),
		]);
	});
});
