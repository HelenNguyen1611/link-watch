import type { LinkView } from "@linkwatch/core";
import { describe, expect, it } from "vitest";
import { nextSort, sortLinks } from "./sort";

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

describe("sortLinks — links table sorting", () => {
	it("FR-17: no sort keeps the API order (newest first)", () => {
		const links = [link("b"), link("a")];
		expect(ids(sortLinks(links, null))).toEqual(["b", "a"]);
	});

	it("FR-09: status ascending = worst first", () => {
		const links = [
			link("up", { status: "up" }),
			link("pending", { status: "pending" }),
			link("dead", { status: "dead" }),
			link("slow", { status: "slow" }),
			link("down", { status: "down" }),
			link("suspect", { status: "suspect" }),
		];
		expect(ids(sortLinks(links, { key: "status", dir: "asc" }))).toEqual([
			"down",
			"dead",
			"suspect",
			"slow",
			"up",
			"pending",
		]);
	});

	it("FR-17: numbers compare as numbers; links never checked stay last in both directions", () => {
		const links = [
			link("fast", { lastResponseMs: 90 }),
			link("never"),
			link("slow", { lastResponseMs: 7200 }),
			link("mid", { lastResponseMs: 800 }),
		];
		expect(ids(sortLinks(links, { key: "responseTime", dir: "desc" }))).toEqual(
			["slow", "mid", "fast", "never"],
		);
		expect(ids(sortLinks(links, { key: "responseTime", dir: "asc" }))).toEqual([
			"fast",
			"mid",
			"slow",
			"never",
		]);
	});

	it("FR-17: text is case-insensitive with natural number order", () => {
		const links = [
			link("p10", { url: "https://abc.com/page10" }),
			link("B", { url: "https://ABC.com/b" }),
			link("p2", { url: "https://abc.com/page2" }),
		];
		expect(ids(sortLinks(links, { key: "url", dir: "asc" }))).toEqual([
			"B",
			"p2",
			"p10",
		]);
	});

	it("dates: added and last checked", () => {
		const links = [
			link("old", {
				createdAt: "2026-09-01T00:00:00.000Z",
				lastCheckedAt: "2026-09-30T00:00:00.000Z",
			}),
			link("new", { createdAt: "2026-09-29T00:00:00.000Z" }),
		];
		expect(ids(sortLinks(links, { key: "added", dir: "desc" }))).toEqual([
			"new",
			"old",
		]);
		expect(ids(sortLinks(links, { key: "lastChecked", dir: "asc" }))).toEqual([
			"old",
			"new",
		]);
	});

	it("ties keep the API order and the input is not mutated", () => {
		const links = [
			link("1", { domain: "x.vn" }),
			link("2", { domain: "x.vn" }),
		];
		expect(ids(sortLinks(links, { key: "domain", dir: "desc" }))).toEqual([
			"1",
			"2",
		]);
		expect(ids(links)).toEqual(["1", "2"]);
	});
});

describe("nextSort — header clicks", () => {
	it("first click uses the column's natural direction, then flips, then resets", () => {
		const first = nextSort(null, "lastChecked");
		expect(first).toEqual({ key: "lastChecked", dir: "desc" });
		const second = nextSort(first, "lastChecked");
		expect(second).toEqual({ key: "lastChecked", dir: "asc" });
		expect(nextSort(second, "lastChecked")).toBeNull();
	});

	it("clicking another column starts over on that column", () => {
		expect(nextSort({ key: "url", dir: "desc" }, "domain")).toEqual({
			key: "domain",
			dir: "asc",
		});
	});
});
