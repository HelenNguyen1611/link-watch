import { describe, expect, it } from "vitest";
import { isActive, MAIN_NAV, SETTINGS_NAV } from "./nav";

describe("nav", () => {
	it("has main items SCR-01, 02, 03, 06, 07 and the Settings group SCR-08, 09 + API key", () => {
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

	it("every href ends with / (static export trailingSlash)", () => {
		for (const i of [...MAIN_NAV, ...SETTINGS_NAV])
			expect(i.href.endsWith("/")).toBe(true);
	});

	it("'/' matches only the home page; other items match by prefix, with or without a trailing /", () => {
		expect(isActive("/", "/")).toBe(true);
		expect(isActive("/", "/links/")).toBe(false);
		expect(isActive("/links/", "/links")).toBe(true);
		expect(isActive("/links/", "/links/detail/")).toBe(true);
		expect(isActive("/settings/email/", "/settings/api-key/")).toBe(false);
	});
});
