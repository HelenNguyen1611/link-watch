import { describe, expect, it } from "vitest";
import { isActive, MAIN_NAV, SETTINGS_NAV } from "./nav";

describe("nav", () => {
	it("đủ mục chính SCR-01, 02, 03, 06, 07 và nhóm Cài đặt SCR-08, 09 + khóa API", () => {
		expect(MAIN_NAV.map((i) => i.screen)).toEqual([
			"SCR-01",
			"SCR-02",
			"SCR-03",
			"SCR-06",
			"SCR-07",
		]);
		expect(SETTINGS_NAV.map((i) => i.href)).toEqual([
			"/settings/email/",
			"/settings/account/",
			"/settings/api-key/",
		]);
	});

	it("mọi href kết thúc bằng / (static export trailingSlash)", () => {
		for (const i of [...MAIN_NAV, ...SETTINGS_NAV])
			expect(i.href.endsWith("/")).toBe(true);
	});

	it("'/' chỉ khớp trang chủ, mục khác khớp theo tiền tố, có hoặc không dấu / cuối", () => {
		expect(isActive("/", "/")).toBe(true);
		expect(isActive("/", "/links/")).toBe(false);
		expect(isActive("/links/", "/links")).toBe(true);
		expect(isActive("/links/", "/links/detail/")).toBe(true);
		expect(isActive("/settings/email/", "/settings/api-key/")).toBe(false);
	});
});
