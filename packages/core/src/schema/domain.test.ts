import { describe, expect, it } from "vitest";
import { DomainInput, DomainName } from "./domain";

describe("DomainName", () => {
	it("FR-07: nhận domain chính đã chuẩn hóa, hạ chữ thường", () => {
		expect(DomainName.parse(" ABC.com.VN ")).toBe("abc.com.vn");
		expect(DomainName.parse("abc.github.io")).toBe("abc.github.io");
	});

	it.each(["", "https://abc.com", "abc.com/x", "a b.com"])(
		"FR-07: từ chối chuỗi không phải domain: %j",
		(value) => {
			expect(DomainName.safeParse(value).success).toBe(false);
		},
	);
});

describe("DomainInput", () => {
	it("FR-08: mặc định bật, không cảnh báo chậm, không bỏ qua 403", () => {
		expect(DomainInput.parse({})).toEqual({
			enabled: true,
			slowAlert: false,
			ignoreWaf403: false,
			recipients: [],
		});
	});

	it("FR-08: nhận tên hiển thị, mô tả, người phụ trách, lịch riêng", () => {
		const d = DomainInput.parse({
			displayName: "  ABC Shop ",
			description: "Site bán hàng",
			owner: "Lan@ABC.com",
			scheduleId: "sched_15m",
			enabled: false,
		});
		expect(d).toMatchObject({
			displayName: "ABC Shop",
			description: "Site bán hàng",
			owner: "lan@abc.com",
			scheduleId: "sched_15m",
			enabled: false,
		});
	});

	it("FR-08: danh sách người nhận là email hợp lệ, hạ chữ thường, loại trùng", () => {
		const d = DomainInput.parse({
			recipients: ["A@abc.com", "a@abc.com ", "b@abc.com"],
		});
		expect(d.recipients).toEqual(["a@abc.com", "b@abc.com"]);
		expect(DomainInput.safeParse({ recipients: ["not-email"] }).success).toBe(
			false,
		);
	});
});
