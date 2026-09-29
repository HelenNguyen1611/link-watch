import { describe, expect, it } from "vitest";
import { containsKeyword } from "./keyword";

describe("containsKeyword", () => {
	it("FR-01: không phân biệt hoa/thường (nhập 'Liên hệ', trang ghi 'LIÊN HỆ')", () => {
		expect(containsKeyword("<a>LIÊN HỆ</a>", "Liên hệ")).toBe(true);
		expect(containsKeyword("<a>liên hệ</a>", "LIÊN HỆ")).toBe(true);
		expect(containsKeyword("Đặt Hàng ngay", "đặt hàng")).toBe(true);
	});

	it("FR-01: không phụ thuộc cách mã hóa Unicode (NFC/NFD)", () => {
		expect(
			containsKeyword("Liên hệ".normalize("NFD"), "Liên hệ".normalize("NFC")),
		).toBe(true);
	});

	it("FR-01: vẫn phân biệt dấu tiếng Việt", () => {
		expect(containsKeyword("Lien he", "Liên hệ")).toBe(false);
	});

	it("FR-01: không có từ khóa → false", () => {
		expect(containsKeyword("Xin chào", "Liên hệ")).toBe(false);
	});
});
