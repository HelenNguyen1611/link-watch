import { describe, expect, it } from "vitest";
import { LinkInput } from "./link";

describe("LinkInput", () => {
	it("FR-01: chỉ cần URL, các trường khác lấy giá trị mặc định", () => {
		expect(LinkInput.parse({ url: "https://abc.com/x" })).toEqual({
			url: "https://abc.com/x",
			tags: [],
			method: "GET",
			expectedCodes: [{ from: 200, to: 399 }],
			timeoutS: 30,
		});
	});

	it("FR-01: URL là bắt buộc", () => {
		expect(LinkInput.safeParse({}).success).toBe(false);
	});

	it("FR-02: URL được chuẩn hóa khi parse", () => {
		const link = LinkInput.parse({ url: "  HTTPS://Shop.ABC.com/a#x " });
		expect(link.url).toBe("https://shop.abc.com/a");
	});

	it("FR-01: URL sai trả lỗi ở trường url kèm mã lỗi", () => {
		const r = LinkInput.safeParse({ url: "ftp://abc.com" });
		expect(r.success).toBe(false);
		expect(r.error?.issues[0]).toMatchObject({
			path: ["url"],
			params: { code: "unsupported_scheme" },
		});
	});

	it("FR-01: nhận đủ các trường tùy chọn", () => {
		const link = LinkInput.parse({
			url: "https://abc.com/x",
			name: "  Trang chủ  ",
			tags: [" khách-hàng ", "seo"],
			method: "HEAD",
			expectedCodes: [
				{ from: 200, to: 299 },
				{ from: 301, to: 301 },
			],
			timeoutS: 10,
			keyword: "  Liên hệ ",
		});
		expect(link).toMatchObject({
			name: "Trang chủ",
			tags: ["khách-hàng", "seo"],
			method: "HEAD",
			expectedCodes: [
				{ from: 200, to: 299 },
				{ from: 301, to: 301 },
			],
			timeoutS: 10,
			keyword: "Liên hệ",
		});
	});

	it("FR-01: tên và từ khóa rỗng coi như không nhập", () => {
		const link = LinkInput.parse({
			url: "https://abc.com/",
			name: "   ",
			keyword: "",
		});
		expect(link.name).toBeUndefined();
		expect(link.keyword).toBeUndefined();
	});

	it("FR-01: tag bị trùng hoặc rỗng được loại bỏ", () => {
		const link = LinkInput.parse({
			url: "https://abc.com/",
			tags: ["seo", " seo ", "", "SEO"],
		});
		expect(link.tags).toEqual(["seo", "SEO"]);
	});

	it("FR-01: phương thức chỉ GET hoặc HEAD", () => {
		expect(
			LinkInput.safeParse({ url: "https://abc.com/", method: "POST" }).success,
		).toBe(false);
	});

	it.each([
		[[]],
		[[{ from: 99, to: 200 }]],
		[[{ from: 200, to: 600 }]],
		[[{ from: 300, to: 200 }]],
		[[{ from: 200.5, to: 299 }]],
	])("FR-01: mã HTTP mong đợi không hợp lệ: %j", (expectedCodes) => {
		expect(
			LinkInput.safeParse({ url: "https://abc.com/", expectedCodes }).success,
		).toBe(false);
	});

	it.each([[0], [61], [2.5]])(
		"FR-01: timeout ngoài 1–60 giây hoặc không nguyên bị từ chối: %d",
		(timeoutS) => {
			expect(
				LinkInput.safeParse({ url: "https://abc.com/", timeoutS }).success,
			).toBe(false);
		},
	);
});
