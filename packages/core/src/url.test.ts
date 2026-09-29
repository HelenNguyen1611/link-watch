import { describe, expect, it } from "vitest";
import { InvalidUrlError, MAX_URL_LENGTH, normalizeUrl } from "./url";

describe("normalizeUrl", () => {
	it("FR-02: bỏ khoảng trắng đầu/cuối", () => {
		expect(normalizeUrl("  https://abc.com/x \n\t")).toBe("https://abc.com/x");
	});

	it("FR-02: hạ chữ thường scheme và host, giữ nguyên path/query", () => {
		expect(normalizeUrl("HTTPS://Shop.ABC.com/Path/To?Q=Ab")).toBe(
			"https://shop.abc.com/Path/To?Q=Ab",
		);
	});

	it("FR-02: bỏ #fragment", () => {
		expect(normalizeUrl("https://abc.com/a?b=1#section-2")).toBe(
			"https://abc.com/a?b=1",
		);
		expect(normalizeUrl("https://abc.com/#")).toBe("https://abc.com/");
	});

	it("FR-02: các cách viết khác nhau của cùng một URL cho cùng khóa chống trùng", () => {
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

	it("FR-02: http và https là hai link khác nhau", () => {
		expect(normalizeUrl("http://abc.com/")).not.toBe(
			normalizeUrl("https://abc.com/"),
		);
	});

	it("FR-02: host tiếng Việt (IDN) được chuyển sang punycode", () => {
		expect(normalizeUrl("https://Tiếngviệt.vn/a")).toBe(
			"https://xn--tingvit-5t4cyc.vn/a",
		);
	});

	it("FR-01: chấp nhận http và https", () => {
		expect(normalizeUrl("http://xyz.vn/x")).toBe("http://xyz.vn/x");
		expect(normalizeUrl("https://xyz.vn/x")).toBe("https://xyz.vn/x");
	});

	it.each([
		["ftp://abc.com/file"],
		["mailto:a@abc.com"],
		["javascript:alert(1)"],
		["file:///etc/passwd"],
	])("FR-01: từ chối scheme khác http/https: %s", (input) => {
		expect(() => normalizeUrl(input)).toThrow(InvalidUrlError);
	});

	it.each([[""], ["   "], ["abc.com/x"], ["https://"], ["not a url"]])(
		"FR-01: từ chối chuỗi không phải URL: %j",
		(input) => {
			expect(() => normalizeUrl(input)).toThrow(InvalidUrlError);
		},
	);

	it("FR-01: URL dài đúng 2.048 ký tự được chấp nhận, dài hơn bị từ chối", () => {
		const base = "https://abc.com/";
		const ok = base + "a".repeat(MAX_URL_LENGTH - base.length);
		expect(normalizeUrl(ok)).toHaveLength(MAX_URL_LENGTH);
		expect(() => normalizeUrl(`${ok}a`)).toThrow(InvalidUrlError);
	});

	it("FR-01: độ dài tính sau khi chuẩn hóa (ký tự được mã hóa %xx)", () => {
		const base = "https://abc.com/";
		// mỗi dấu cách thành %20 (3 ký tự)
		const input =
			base +
			" ".repeat(Math.ceil((MAX_URL_LENGTH - base.length) / 3) + 1) +
			"x";
		expect(() => normalizeUrl(input)).toThrow(InvalidUrlError);
	});

	it("lỗi có mã để UI hiển thị thông điệp theo ngôn ngữ", () => {
		expect(() => normalizeUrl("ftp://abc.com")).toThrow(
			expect.objectContaining({ code: "unsupported_scheme" }),
		);
		expect(() => normalizeUrl("abc")).toThrow(
			expect.objectContaining({ code: "invalid_url" }),
		);
	});
});
