import type { LinkView } from "@linkwatch/core";
import { describe, expect, it } from "vitest";
import { mergeOverrides, pruneOverrides } from "./overlay";

const link = (id: string, over: Partial<LinkView> = {}): LinkView => ({
	id,
	domain: "abc.com",
	url: `https://abc.com/${id}`,
	tags: [],
	method: "GET",
	expectedCodes: [{ from: 200, to: 399 }],
	timeoutS: 30,
	status: "up",
	paused: false,
	createdAt: "2026-09-29T00:00:00.000Z",
	...over,
});
const SNAP = "2026-09-30T08:00:00.000Z";
const after = Date.parse(SNAP) + 1000;
const before = Date.parse(SNAP) - 1000;
const ids = (rows: LinkView[]) => rows.map((r) => r.id);

describe("mergeOverrides — step 19b snapshot + fresh rows", () => {
	it("no overrides → the snapshot as is", () => {
		expect(
			ids(mergeOverrides([link("a"), link("b")], SNAP, new Map())),
		).toEqual(["a", "b"]);
	});

	it("a newer row replaces the snapshot row; a deleted link disappears", () => {
		const rows = mergeOverrides(
			[link("a"), link("b")],
			SNAP,
			new Map([
				["a", { row: link("a", { status: "dead" }), at: after }],
				["b", { row: null, at: after }],
			]),
		);
		expect(rows.map((r) => [r.id, r.status])).toEqual([["a", "dead"]]);
	});

	it("a link added after the snapshot shows first, newest first", () => {
		const rows = mergeOverrides(
			[link("a")],
			SNAP,
			new Map([
				[
					"n1",
					{
						row: link("n1", { createdAt: "2026-09-30T08:01:00.000Z" }),
						at: after,
					},
				],
				[
					"n2",
					{
						row: link("n2", { createdAt: "2026-09-30T08:02:00.000Z" }),
						at: after,
					},
				],
			]),
		);
		expect(ids(rows)).toEqual(["n2", "n1", "a"]);
	});

	it("overrides older than the snapshot are already in it → ignored and pruned", () => {
		const overrides = new Map([
			["a", { row: link("a", { status: "dead" }), at: before }],
		]);
		expect(mergeOverrides([link("a")], SNAP, overrides)[0]?.status).toBe("up");
		expect(pruneOverrides(overrides, SNAP).size).toBe(0);
		expect(
			pruneOverrides(new Map([["a", { row: null, at: after }]]), SNAP).size,
		).toBe(1);
	});

	it("no snapshot yet → every override applies", () => {
		expect(
			ids(
				mergeOverrides(
					[],
					undefined,
					new Map([["x", { row: link("x"), at: 1 }]]),
				),
			),
		).toEqual(["x"]);
	});
});
