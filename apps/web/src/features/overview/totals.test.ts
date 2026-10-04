import type { DomainSummary, IncidentView } from "@linkwatch/core";
import { describe, expect, it } from "vitest";
import { needsAttention, overviewTotals, recentlyClosed } from "./totals";

const d = (over: Partial<DomainSummary>): DomainSummary => ({
	name: "a.vn",
	enabled: true,
	slowAlert: false,
	ignoreWaf403: false,
	status: "normal",
	counts: { pending: 0, up: 0, slow: 0, dead: 0, down: 0, suspect: 0 },
	paused: 0,
	total: 0,
	schedule: { source: "default" },
	...over,
});

describe("overview totals — SCR-01 (FR-09, FR-10)", () => {
	it("FR-10: sums links per status and domains per status; uptime is weighted by active links", () => {
		const totals = overviewTotals([
			d({
				name: "a.vn",
				status: "error",
				counts: { pending: 0, up: 8, slow: 1, dead: 1, down: 0, suspect: 0 },
				total: 12,
				paused: 2,
				uptime7: 90,
			}),
			d({
				name: "b.vn",
				counts: { pending: 1, up: 29, slow: 0, dead: 0, down: 0, suspect: 0 },
				total: 30,
				uptime7: 100,
			}),
			d({ name: "c.vn", total: 0 }),
		]);
		expect(totals.domains).toEqual({
			down: 0,
			error: 1,
			warning: 0,
			normal: 2,
		});
		expect(totals.links).toMatchObject({
			up: 37,
			slow: 1,
			dead: 1,
			pending: 1,
		});
		expect(totals.active).toBe(40);
		expect(totals.paused).toBe(2);
		// (90 × 10 + 100 × 30) / 40
		expect(totals.uptime7).toBe(97.5);
	});

	it("no uptime data yet → no uptime", () => {
		expect(overviewTotals([d({ total: 3 })]).uptime7).toBeUndefined();
	});

	it("FR-09: needs attention lists enabled non-Normal domains, Down first, then Error, Warning", () => {
		const list = needsAttention([
			d({ name: "w.vn", status: "warning" }),
			d({ name: "ok.vn", status: "normal" }),
			d({ name: "z.vn", status: "down" }),
			d({ name: "e.vn", status: "error" }),
			d({ name: "a.vn", status: "down" }),
			d({ name: "off.vn", status: "down", enabled: false }),
		]);
		expect(list.map((x) => x.name)).toEqual(["a.vn", "z.vn", "e.vn", "w.vn"]);
	});
});

describe("recentlyClosed — SCR-01", () => {
	const now = new Date("2026-10-05T00:00:00.000Z");
	const inc = (id: string, over: Partial<IncidentView>): IncidentView => ({
		id,
		linkId: id,
		domain: "a.vn",
		url: `https://a.vn/${id}`,
		type: "down",
		state: "closed",
		openedAt: "2026-10-01T00:00:00.000Z",
		...over,
	});

	it("keeps closed incidents within the window, most recently closed first", () => {
		const out = recentlyClosed(
			[
				inc("a", { closedAt: "2026-10-04T01:00:00.000Z" }),
				inc("b", { closedAt: "2026-10-04T23:00:00.000Z" }),
				inc("old", { closedAt: "2026-10-03T23:59:59.000Z" }),
				inc("open", { state: "open" }),
			],
			now,
		);
		expect(out.map((i) => i.id)).toEqual(["b", "a"]);
	});

	it("the window edge is inclusive", () => {
		expect(
			recentlyClosed(
				[inc("edge", { closedAt: "2026-10-04T00:00:00.000Z" })],
				now,
			),
		).toHaveLength(1);
	});
});
