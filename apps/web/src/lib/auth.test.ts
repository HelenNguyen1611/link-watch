import { describe, expect, it, vi } from "vitest";
import {
	isPublicPath,
	loadAuthSetup,
	loginUrl,
	newPasswordSchema,
	safeNext,
	unmetPasswordRules,
} from "./auth";

const config = {
	region: "ap-southeast-1",
	userPoolId: "ap-southeast-1_abc",
	userPoolClientId: "client123",
};
const response = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), { status });

describe("auth helpers", () => {
	it("FR-28: after sign-in only same-site paths are followed (no open redirect)", () => {
		expect(safeNext("/links/?d=abc.com")).toBe("/links/?d=abc.com");
		expect(safeNext("/settings/email/")).toBe("/settings/email/");
		for (const bad of [
			null,
			"",
			"https://evil.com/",
			"//evil.com/x",
			"/\\evil.com",
			"javascript:alert(1)",
			"links/",
		])
			expect(safeNext(bad)).toBe("/");
		// Never loop back to the sign-in page itself.
		expect(safeNext("/login/?next=/links/")).toBe("/");
	});

	it("FR-28: /login/ and /confirm/ (SCR-10) are public, every other page needs sign-in", () => {
		expect(isPublicPath("/login/")).toBe(true);
		expect(isPublicPath("/login")).toBe(true);
		expect(isPublicPath("/confirm/")).toBe(true);
		expect(isPublicPath("/")).toBe(false);
		expect(isPublicPath("/links/")).toBe(false);
		expect(isPublicPath("/login-help/")).toBe(false);
	});

	it("builds /login/?next=<encoded page>", () => {
		expect(loginUrl("/links/?d=a.com")).toBe(
			"/login/?next=%2Flinks%2F%3Fd%3Da.com",
		);
	});

	it("FR-28, NFR-07: password rules match the User Pool policy (≥ 12, lower, upper, digit)", () => {
		expect(unmetPasswordRules("")).toEqual([
			"too_short",
			"no_lowercase",
			"no_uppercase",
			"no_digit",
		]);
		expect(unmetPasswordRules("abcdefghijkl")).toEqual([
			"no_uppercase",
			"no_digit",
		]);
		expect(unmetPasswordRules("Abcdefghijk1")).toEqual([]);
	});

	it("new password form: first unmet rule on the password, mismatch on the confirmation", () => {
		const bad = newPasswordSchema.safeParse({
			password: "short",
			confirm: "x",
		});
		expect(bad.success).toBe(false);
		const issues = bad.error?.issues.map((i) => [i.path[0], i.message]);
		expect(issues).toEqual([
			["password", "too_short"],
			["confirm", "mismatch"],
		]);
		expect(
			newPasswordSchema.safeParse({
				password: "Abcdefghijk1",
				confirm: "Abcdefghijk1",
			}).success,
		).toBe(true);
	});

	it("FR-28: /auth-config.json present → Cognito with its ids", async () => {
		const fetch = vi.fn(async () => response(200, config));
		expect(await loadAuthSetup({ fetch, dev: false })).toEqual({
			kind: "cognito",
			config,
		});
		expect(fetch).toHaveBeenCalledWith("/auth-config.json", {
			cache: "no-store",
		});
	});

	it("NFR-07: production without a valid config never falls back to the fake sign-in", async () => {
		for (const fetch of [
			vi.fn(async () => response(404, {})),
			vi.fn(async () => response(200, { region: "x" })),
			vi.fn(async () => {
				throw new Error("offline");
			}),
		])
			expect(await loadAuthSetup({ fetch, dev: false })).toEqual({
				kind: "unconfigured",
			});
	});

	it("next dev without a config → local fake sign-in", async () => {
		const fetch = vi.fn(async () => response(404, {}));
		expect(await loadAuthSetup({ fetch, dev: true })).toEqual({
			kind: "local",
		});
	});
});
