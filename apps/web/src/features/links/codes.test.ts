import { describe, expect, it } from "vitest";
import { formatCodes, parseCodes } from "./codes";

describe("expected HTTP codes text — FR-01", () => {
	it("FR-01: formats and parses ranges and single codes", () => {
		expect(
			formatCodes([
				{ from: 200, to: 399 },
				{ from: 404, to: 404 },
			]),
		).toBe("200-399, 404");
		expect(parseCodes(" 200-299 ; 301 404 ")).toEqual([
			{ from: 200, to: 299 },
			{ from: 301, to: 301 },
			{ from: 404, to: 404 },
		]);
	});

	it("FR-01: anything else is rejected", () => {
		expect(parseCodes("")).toBeNull();
		expect(parseCodes("2xx")).toBeNull();
		expect(parseCodes("200-")).toBeNull();
	});
});
