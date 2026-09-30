import type { LinkStatus, LinkView } from "@linkwatch/core";
import { describe, expect, it } from "vitest";
import { defaultSamples, runSmoke } from "./smoke";

type FakeOptions = {
	/** Status each link gets once "checked"; missing = stays pending. */
	checkedAs?: (url: string, poll: number) => LinkStatus | undefined;
	/** Number of polls before links leave pending. */
	checkAfterPolls?: number;
	healthStatus?: number;
	noKeyStatus?: number;
	deleteStatus?: number;
	/** Status of DELETE on an unknown link (CloudFront used to turn it into HTML). */
	missingStatus?: number;
};

/** In-memory stand-in for the deployed API, mirroring the real routes. */
function fakeApi(o: FakeOptions = {}) {
	const links = new Map<string, LinkView>();
	const deleted: string[] = [];
	let polls = 0;
	let seq = 0;
	const json = (status: number, body?: unknown) =>
		new Response(body === undefined ? null : JSON.stringify(body), { status });

	const fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
		const url = new URL(String(input));
		const method = init.method ?? "GET";
		const hasKey =
			new Headers(init.headers).get("authorization") === "Bearer tok";
		if (url.pathname === "/api/health")
			return json(o.healthStatus ?? 200, { ok: true });
		if (!hasKey) return json(o.noKeyStatus ?? 401, { error: "unauthorized" });
		if (url.pathname === "/api/links" && method === "POST") {
			const body = JSON.parse(String(init.body)) as { url: string };
			const link = {
				id: `id${++seq}`,
				url: body.url,
				status: "pending",
			} as LinkView;
			links.set(link.id, link);
			return json(201, link);
		}
		if (url.pathname === "/api/links" && method === "GET") {
			if (++polls > (o.checkAfterPolls ?? 1))
				for (const l of links.values())
					l.status = o.checkedAs?.(l.url, polls) ?? l.status;
			// One link per page to exercise cursor paging.
			const all = [...links.values()];
			const i = Number(url.searchParams.get("cursor") ?? 0);
			return json(200, {
				items: all.slice(i, i + 1),
				cursor: i + 1 < all.length ? String(i + 1) : null,
			});
		}
		if (method === "DELETE") {
			const id = url.pathname.split("/").pop() ?? "";
			if (!links.has(id))
				return json(o.missingStatus ?? 404, { error: "not_found" });
			deleted.push(id);
			links.delete(id);
			return json(o.deleteStatus ?? 204);
		}
		return json(404, { error: "not_found" });
	};
	return { fetch: fetch as typeof globalThis.fetch, deleted };
}

const samples = defaultSamples("run1");
const expectedByUrl = (url: string) =>
	samples.find((s) => s.input.url === url)?.expected;

const opts = (api: ReturnType<typeof fakeApi>, extra = {}) => {
	let t = 0;
	return {
		baseUrl: "https://lw.test/",
		token: "tok",
		samples,
		fetch: api.fetch,
		sleep: async (ms: number) => {
			t += ms;
		},
		now: () => t,
		pollMs: 1000,
		timeoutMs: 5000,
		...extra,
	};
};

describe("smoke test (steps 40a, 40b)", () => {
	it("FR-17: one sample link per SRS 5.1 result, each URL unique per run", () => {
		expect(samples.map((s) => s.expected)).toEqual([
			"up",
			"slow",
			"dead",
			"down",
		]);
		for (const s of samples)
			expect(s.input.url).toContain("linkwatch-smoke=run1");
	});

	it("FR-17: passes when every link reaches its expected status, then deletes them", async () => {
		const api = fakeApi({ checkedAs: expectedByUrl, checkAfterPolls: 2 });
		const report = await runSmoke(opts(api));
		expect(report.failures).toEqual([]);
		expect(report.ok).toBe(true);
		expect(report.links.map((l) => l.actual)).toEqual([
			"up",
			"slow",
			"dead",
			"down",
		]);
		expect(api.deleted).toHaveLength(4);
	});

	it("FR-17: fails on a wrong status and still deletes the sample links", async () => {
		const api = fakeApi({
			checkedAs: (u) => (u.includes("404") ? "up" : expectedByUrl(u)),
		});
		const report = await runSmoke(opts(api));
		expect(report.ok).toBe(false);
		expect(report.failures).toEqual([
			expect.stringContaining("expected dead, got up"),
		]);
		expect(api.deleted).toHaveLength(4);
	});

	it("NFR-01: fails when links are not checked before the deadline", async () => {
		const api = fakeApi({ checkedAs: () => undefined });
		const report = await runSmoke(opts(api));
		expect(report.ok).toBe(false);
		expect(report.failures).toHaveLength(4);
		expect(report.failures[0]).toContain("still pending after");
		expect(api.deleted).toHaveLength(4);
	});

	it("5.2: a failing link is Suspect after the first check; the smoke test waits for the recheck", async () => {
		const api = fakeApi({
			// Poll 2: first check (failures are Suspect); poll 4: recheck confirms them.
			checkedAs: (u, poll) => {
				const expected = expectedByUrl(u);
				if (expected === "dead" || expected === "down")
					return poll < 4 ? "suspect" : expected;
				return expected;
			},
			checkAfterPolls: 1,
		});
		const report = await runSmoke(opts(api));
		expect(report.failures).toEqual([]);
		expect(report.links.map((l) => l.actual)).toEqual([
			"up",
			"slow",
			"dead",
			"down",
		]);
	});

	it("5.2: a link still Suspect at the deadline fails with a clear message", async () => {
		const api = fakeApi({
			checkedAs: (u) =>
				expectedByUrl(u) === "dead" ? "suspect" : expectedByUrl(u),
		});
		const report = await runSmoke(opts(api));
		expect(report.failures).toEqual([
			expect.stringContaining(
				"status/404?linkwatch-smoke=run1: still suspect after",
			),
		]);
	});

	it("step 37c: fails when an API 404 is not JSON through CloudFront", async () => {
		const api = fakeApi({ checkedAs: expectedByUrl, missingStatus: 200 });
		const report = await runSmoke(opts(api));
		expect(report.ok).toBe(false);
		expect(report.failures).toEqual([
			expect.stringContaining('expected 404 {"error":"not_found"}'),
		]);
		expect(api.deleted).toHaveLength(0);
	});

	it("NFR-07: fails fast when a request without a token is not rejected", async () => {
		const api = fakeApi({ noKeyStatus: 200 });
		const report = await runSmoke(opts(api));
		expect(report.ok).toBe(false);
		expect(report.failures).toEqual([
			expect.stringContaining("expected 401, got 200"),
		]);
		expect(api.deleted).toHaveLength(0);
	});

	it("FR-04: a failed delete fails the run", async () => {
		const api = fakeApi({ checkedAs: expectedByUrl, deleteStatus: 500 });
		const report = await runSmoke(opts(api));
		expect(report.ok).toBe(false);
		expect(report.failures).toHaveLength(4);
		expect(report.failures[0]).toContain("DELETE");
	});
});
