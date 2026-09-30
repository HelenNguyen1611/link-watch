import { describe, expect, it } from "vitest";
import { ImportTooLargeError, MAX_IMPORT_ROWS, parseImport } from "./import";

describe("parseImport — FR-03", () => {
	it("AC-01: plain list, one URL per line; URLs are normalized", () => {
		const rows = parseImport(
			"https://a.abc.com/x\n\n  https://B.abc.com/y#top \nhttps://xyz.vn\n",
		);
		expect(rows.map((r) => [r.line, r.url, r.status])).toEqual([
			[1, "https://a.abc.com/x", "valid"],
			[2, "https://b.abc.com/y", "valid"],
			[3, "https://xyz.vn/", "valid"],
		]);
	});

	it("FR-03: CSV with a header, columns in any order, optional fields", () => {
		const rows = parseImport(
			'Name,URL,tags,method,expected_codes,timeout_s,keyword\r\nShop,https://shop.vn/,"a;b",head,200-299;404,10,Buy\r\n',
		);
		expect(rows[0]?.status).toBe("valid");
		expect(rows[0]?.input).toMatchObject({
			url: "https://shop.vn/",
			name: "Shop",
			tags: ["a", "b"],
			method: "HEAD",
			expectedCodes: [
				{ from: 200, to: 299 },
				{ from: 404, to: 404 },
			],
			timeoutS: 10,
			keyword: "Buy",
		});
		expect(rows[0]?.line).toBe(2);
	});

	it("FR-03: preview marks invalid URLs, invalid fields and duplicates inside the file", () => {
		const rows = parseImport(
			"url,timeout_s\nftp://a.vn/,\nhttps://a.vn/,999\nhttps://b.vn/,\nhttps://B.vn/#x,\n",
		);
		expect(
			rows.map((r) => ({
				line: r.line,
				status: r.status,
				error: r.error,
				field: r.field,
			})),
		).toEqual([
			{ line: 2, status: "error", error: "invalid_url", field: undefined },
			{ line: 3, status: "error", error: "invalid_field", field: "timeoutS" },
			{ line: 4, status: "valid", error: undefined, field: undefined },
			{
				line: 5,
				status: "duplicate",
				error: "duplicate_in_file",
				field: undefined,
			},
		]);
	});

	it("FR-03: more than 1,000 rows is refused", () => {
		const text = Array.from(
			{ length: MAX_IMPORT_ROWS + 1 },
			(_, i) => `https://a.vn/${i}`,
		).join("\n");
		expect(() => parseImport(text)).toThrow(ImportTooLargeError);
		expect(
			parseImport(text.split("\n").slice(0, MAX_IMPORT_ROWS).join("\n")),
		).toHaveLength(MAX_IMPORT_ROWS);
	});

	it("empty input → nothing to import", () => {
		expect(parseImport("\n  \n")).toEqual([]);
	});
});
