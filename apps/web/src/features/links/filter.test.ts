import type { LinkView } from "@linkwatch/core";
import { describe, expect, it } from "vitest";
import {
	EMPTY_FILTER,
	filterLinks,
	isFilterActive,
	LinkFilter,
} from "./filter";

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
	createdAt: "2026-09-29T10:00:00.000Z",
	...over,
});
const ids = (links: LinkView[]) => links.map((l) => l.id);
const f = (over: Partial<LinkFilter>): LinkFilter => ({
	...EMPTY_FILTER,
	...over,
});

describe("filterLinks — links table filters", () => {
	const links = [
		link("pricing", { url: "https://Shop.ABC.com/pricing", domain: "abc.com" }),
		link("blog", {
			url: "https://xyz.vn/blog",
			domain: "xyz.vn",
			name: "Company Blog",
		}),
		link("home", { url: "https://xyz.vn/", domain: "xyz.vn", status: "dead" }),
	];

	it("no filter keeps every link", () => {
		expect(ids(filterLinks(links, EMPTY_FILTER))).toEqual([
			"pricing",
			"blog",
			"home",
		]);
		expect(isFilterActive(EMPTY_FILTER)).toBe(false);
	});

	it("FR-17: search matches part of the URL, domain or name, case-insensitive, trimmed", () => {
		expect(ids(filterLinks(links, f({ q: " shop.abc " })))).toEqual([
			"pricing",
		]);
		expect(ids(filterLinks(links, f({ q: "XYZ.VN" })))).toEqual([
			"blog",
			"home",
		]);
		expect(ids(filterLinks(links, f({ q: "company blog" })))).toEqual(["blog"]);
		expect(ids(filterLinks(links, f({ q: "nothing" })))).toEqual([]);
	});

	it("FR-17: status filter keeps any of the chosen statuses", () => {
		expect(ids(filterLinks(links, f({ statuses: ["dead"] })))).toEqual([
			"home",
		]);
		expect(ids(filterLinks(links, f({ statuses: ["dead", "up"] })))).toEqual([
			"pricing",
			"blog",
			"home",
		]);
	});

	it("FR-17: check date range is inclusive and follows Vietnam days", () => {
		const checked = [
			// 29/09 23:59 in Vietnam
			link("a", { lastCheckedAt: "2026-09-29T16:59:00.000Z" }),
			// 30/09 00:00 in Vietnam
			link("b", { lastCheckedAt: "2026-09-29T17:00:00.000Z" }),
			// 30/09 23:59:59 in Vietnam
			link("c", { lastCheckedAt: "2026-09-30T16:59:59.000Z" }),
			link("never"),
		];
		expect(ids(filterLinks(checked, f({ checkedFrom: "2026-09-30" })))).toEqual(
			["b", "c"],
		);
		expect(ids(filterLinks(checked, f({ checkedTo: "2026-09-29" })))).toEqual([
			"a",
		]);
		expect(
			ids(
				filterLinks(
					checked,
					f({ checkedFrom: "2026-09-30", checkedTo: "2026-09-30" }),
				),
			),
		).toEqual(["b", "c"]);
	});

	it("filters combine (AND)", () => {
		expect(ids(filterLinks(links, f({ q: "xyz", statuses: ["up"] })))).toEqual([
			"blog",
		]);
	});
});

describe("LinkFilter schema", () => {
	it("rejects an end date before the start date", () => {
		const r = LinkFilter.safeParse(
			f({ checkedFrom: "2026-09-30", checkedTo: "2026-09-01" }),
		);
		expect(r.success).toBe(false);
		expect(r.error?.issues[0]).toMatchObject({
			path: ["checkedTo"],
			message: "dateRange",
		});
	});

	it("accepts empty dates and a same-day range", () => {
		expect(LinkFilter.safeParse(EMPTY_FILTER).success).toBe(true);
		expect(
			LinkFilter.safeParse(
				f({ checkedFrom: "2026-09-30", checkedTo: "2026-09-30" }),
			).success,
		).toBe(true);
	});
});
