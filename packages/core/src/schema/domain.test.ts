import { describe, expect, it } from "vitest";
import { DomainInput, DomainName } from "./domain";

describe("DomainName", () => {
	it("FR-07: accepts a normalized, lowercased root domain", () => {
		expect(DomainName.parse(" ABC.com.VN ")).toBe("abc.com.vn");
		expect(DomainName.parse("abc.github.io")).toBe("abc.github.io");
	});

	it.each(["", "https://abc.com", "abc.com/x", "a b.com"])(
		"FR-07: rejects strings that are not domains: %j",
		(value) => {
			expect(DomainName.safeParse(value).success).toBe(false);
		},
	);
});

describe("DomainInput", () => {
	it("FR-08: defaults to enabled, no slow alerts, no 403 ignore", () => {
		expect(DomainInput.parse({})).toEqual({
			enabled: true,
			slowAlert: false,
			ignoreWaf403: false,
			recipients: [],
		});
	});

	it("FR-08: accepts display name, description, owner, own schedule", () => {
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

	it("FR-08: recipients are valid, lowercased, de-duplicated emails", () => {
		const d = DomainInput.parse({
			recipients: ["A@abc.com", "a@abc.com ", "b@abc.com"],
		});
		expect(d.recipients).toEqual(["a@abc.com", "b@abc.com"]);
		expect(DomainInput.safeParse({ recipients: ["not-email"] }).success).toBe(
			false,
		);
	});
});
