import { describe, expect, it } from "vitest";
import { csvCell, parseCsv, toCsv } from "./csv";

describe("parseCsv — FR-03", () => {
	it("FR-03: fields, quotes, escaped quotes, commas and line breaks inside quotes, CRLF", () => {
		expect(
			parseCsv(
				'url,name\r\nhttps://a.vn/,"Shop, main"\r\n"https://b.vn/","He said ""hi""\nagain"\n',
			),
		).toEqual([
			["url", "name"],
			["https://a.vn/", "Shop, main"],
			["https://b.vn/", 'He said "hi"\nagain'],
		]);
	});

	it("FR-03: strips a UTF-8 BOM and keeps a last line without newline", () => {
		expect(parseCsv("﻿url\nhttps://a.vn/")).toEqual([
			["url"],
			["https://a.vn/"],
		]);
	});

	it("empty input → no rows", () => {
		expect(parseCsv("")).toEqual([]);
	});
});

describe("toCsv — FR-05", () => {
	it("FR-05: quotes only when needed, CRLF line endings", () => {
		expect(
			toCsv([
				["url", "name"],
				["https://a.vn/", 'x, "y"'],
			]),
		).toBe('url,name\r\nhttps://a.vn/,"x, ""y"""\r\n');
	});

	it("FR-05: neutralises spreadsheet formulas; empty for missing values", () => {
		expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
		expect(csvCell(undefined)).toBe("");
		expect(csvCell(404)).toBe("404");
	});

	it("FR-03 / FR-05: round trip", () => {
		const rows = [["a", 'b "c"', "d,e", "line\nbreak"]];
		expect(parseCsv(toCsv(rows))).toEqual(rows);
	});
});
