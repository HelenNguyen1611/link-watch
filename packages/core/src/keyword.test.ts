import { describe, expect, it } from "vitest";
import { containsKeyword } from "./keyword";

describe("containsKeyword", () => {
	it("FR-01: case-insensitive (keyword 'Liên hệ', page says 'LIÊN HỆ')", () => {
		expect(containsKeyword("<a>LIÊN HỆ</a>", "Liên hệ")).toBe(true);
		expect(containsKeyword("<a>liên hệ</a>", "LIÊN HỆ")).toBe(true);
		expect(containsKeyword("Đặt Hàng ngay", "đặt hàng")).toBe(true);
	});

	it("FR-01: independent of Unicode normalization (NFC/NFD)", () => {
		expect(
			containsKeyword("Liên hệ".normalize("NFD"), "Liên hệ".normalize("NFC")),
		).toBe(true);
	});

	it("FR-01: still distinguishes Vietnamese diacritics", () => {
		expect(containsKeyword("Lien he", "Liên hệ")).toBe(false);
	});

	it("FR-01: keyword absent → false", () => {
		expect(containsKeyword("Xin chào", "Liên hệ")).toBe(false);
	});
});
