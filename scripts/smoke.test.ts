import {
	API_KEY_HEADER,
	type LinkStatus,
	type LinkView,
} from "@linkwatch/core";
import { describe, expect, it } from "vitest";
import { defaultSamples, runSmoke } from "./smoke";

type FakeOptions = {
	/** Status each link gets once "checked"; missing = stays pending. */
	checkedAs?: (url: string) => LinkStatus | undefined;
	/** Number of polls before links leave pending. */
	checkAfterPolls?: number;
	healthStatus?: number;
	noKeyStatus?: number;
	deleteStatus?: number;
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
		const hasKey = new Headers(init.headers).get(API_KEY_HEADER) === "k";
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
					l.status = o.checkedAs?.(l.url) ?? l.status;
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
		apiKey: "k",
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

describe("smoke test (step 40a)", () => {
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
		expect(report.failures[0]).toContain("not checked within");
		expect(api.deleted).toHaveLength(4);
	});

	it("NFR-07: fails fast when a request without the API key is not rejected", async () => {
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
