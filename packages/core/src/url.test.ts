import { describe, expect, it } from "vitest";
import { InvalidUrlError, MAX_URL_LENGTH, normalizeUrl } from "./url";

describe("normalizeUrl", () => {
	it("FR-02: trims leading/trailing whitespace", () => {
		expect(normalizeUrl("  https://abc.com/x \n\t")).toBe("https://abc.com/x");
	});

	it("FR-02: lowercases scheme and host, keeps path/query as is", () => {
		expect(normalizeUrl("HTTPS://Shop.ABC.com/Path/To?Q=Ab")).toBe(
			"https://shop.abc.com/Path/To?Q=Ab",
		);
	});

	it("FR-02: strips #fragment", () => {
		expect(normalizeUrl("https://abc.com/a?b=1#section-2")).toBe(
			"https://abc.com/a?b=1",
		);
		expect(normalizeUrl("https://abc.com/#")).toBe("https://abc.com/");
	});

	it("FR-02: different spellings of the same URL give the same dedupe key", () => {
		const variants = [
			"https://abc.com",
			"https://abc.com/",
			" HTTPS://ABC.COM/ ",
			"https://abc.com:443/",
			"https://abc.com/#top",
		];
		const keys = new Set(variants.map(normalizeUrl));
		expect([...keys]).toEqual(["https://abc.com/"]);
	});

	it("FR-02: http and https are two different links", () => {
		expect(normalizeUrl("http://abc.com/")).not.toBe(
			normalizeUrl("https://abc.com/"),
		);
	});

	it("FR-02: a Vietnamese (IDN) host is converted to punycode", () => {
		expect(normalizeUrl("https://Tiếngviệt.vn/a")).toBe(
			"https://xn--tingvit-5t4cyc.vn/a",
		);
	});

	it("FR-01: accepts http and https", () => {
		expect(normalizeUrl("http://xyz.vn/x")).toBe("http://xyz.vn/x");
		expect(normalizeUrl("https://xyz.vn/x")).toBe("https://xyz.vn/x");
	});

	it.each([
		["ftp://abc.com/file"],
		["mailto:a@abc.com"],
		["javascript:alert(1)"],
		["file:///etc/passwd"],
	])("FR-01: rejects schemes other than http/https: %s", (input) => {
		expect(() => normalizeUrl(input)).toThrow(InvalidUrlError);
	});

	it.each([[""], ["   "], ["abc.com/x"], ["https://"], ["not a url"]])(
		"FR-01: rejects strings that are not URLs: %j",
		(input) => {
			expect(() => normalizeUrl(input)).toThrow(InvalidUrlError);
		},
	);

	it("FR-01: a URL of exactly 2,048 characters is accepted, longer is rejected", () => {
		const base = "https://abc.com/";
		const ok = base + "a".repeat(MAX_URL_LENGTH - base.length);
		expect(normalizeUrl(ok)).toHaveLength(MAX_URL_LENGTH);
		expect(() => normalizeUrl(`${ok}a`)).toThrow(InvalidUrlError);
	});

	it("FR-01: length is measured after normalization (%xx-encoded characters)", () => {
		const base = "https://abc.com/";
		// each space becomes %20 (3 characters)
		const input =
			base +
			" ".repeat(Math.ceil((MAX_URL_LENGTH - base.length) / 3) + 1) +
			"x";
		expect(() => normalizeUrl(input)).toThrow(InvalidUrlError);
	});

	it("errors carry a code so the UI can show a localized message", () => {
		expect(() => normalizeUrl("ftp://abc.com")).toThrow(
			expect.objectContaining({ code: "unsupported_scheme" }),
		);
		expect(() => normalizeUrl("abc")).toThrow(
			expect.objectContaining({ code: "invalid_url" }),
		);
	});
});
