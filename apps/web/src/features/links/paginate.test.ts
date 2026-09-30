import { describe, expect, it } from "vitest";
import { paginate } from "./paginate";

const rows = Array.from({ length: 120 }, (_, i) => i + 1);

describe("paginate — links table", () => {
	it("page 3 of 50 → rows 101–120", () => {
		expect(paginate(rows, 3, 50)).toMatchObject({
			page: 3,
			pages: 3,
			from: 101,
			to: 120,
			total: 120,
		});
		expect(paginate(rows, 3, 50).rows).toHaveLength(20);
	});

	it("a page past the end (list shrank) shows the last page", () => {
		expect(paginate(rows.slice(0, 60), 3, 50)).toMatchObject({
			page: 2,
			from: 51,
			to: 60,
		});
	});

	it("empty list → one empty page", () => {
		expect(paginate([], 1, 50)).toEqual({
			rows: [],
			page: 1,
			pages: 1,
			from: 0,
			to: 0,
			total: 0,
		});
	});

	it("page below 1 → page 1", () => {
		expect(paginate(rows, 0, 25).page).toBe(1);
	});
});
