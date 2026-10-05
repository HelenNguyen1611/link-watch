import { describe, expect, it } from "vitest";
import {
	effectiveSettings,
	fromHeader,
	isSenderAllowed,
	RecipientInput,
	SettingsInput,
} from "./settings";

const defaults = {
	sesIdentity: "watch.hueai.net",
	senderEmail: "noreply@watch.hueai.net",
	defaultAdminEmail: "helen@wootech.co",
};

describe("RecipientInput — FR-20", () => {
	it("FR-20: normalizes the email", () => {
		expect(
			RecipientInput.parse({
				scope: "DOMAIN",
				target: " abc.com ",
				email: " Lan@ABC.com ",
			}),
		).toEqual({ scope: "DOMAIN", target: "abc.com", email: "lan@abc.com" });
	});

	it("FR-20: rejects an invalid email or scope", () => {
		expect(
			RecipientInput.safeParse({ scope: "DOMAIN", target: "a", email: "x" })
				.success,
		).toBe(false);
		expect(
			RecipientInput.safeParse({ scope: "USER", target: "a", email: "a@b.co" })
				.success,
		).toBe(false);
	});
});

describe("SettingsInput — FR-23, FR-26", () => {
	it("FR-23: interval in whole hours, at least 1", () => {
		expect(SettingsInput.safeParse({ reminderIntervalHours: 0 }).success).toBe(
			false,
		);
		expect(SettingsInput.parse({ reminderIntervalHours: 6 })).toEqual({
			reminderIntervalHours: 6,
		});
	});

	it("FR-26: unknown fields are rejected", () => {
		expect(SettingsInput.safeParse({ smtpPassword: "x" }).success).toBe(false);
	});
});

describe("effectiveSettings — FR-20, FR-26", () => {
	it("FR-26: no stored item → deployment defaults", () => {
		expect(effectiveSettings(null, defaults)).toEqual({
			senderEmail: "noreply@watch.hueai.net",
			senderName: "LinkWatch",
			defaultAdminEmail: "helen@wootech.co",
			alertEmails: [],
			remindersEnabled: true,
			reminderIntervalHours: 24,
			sesIdentity: "watch.hueai.net",
		});
	});

	it("FR-26: stored values win over defaults", () => {
		expect(
			effectiveSettings(
				{ senderName: "Ops", defaultAdminEmail: "ops@abc.com" },
				defaults,
			),
		).toMatchObject({ senderName: "Ops", defaultAdminEmail: "ops@abc.com" });
	});

	it("FR-20: stored alert users are kept; PATCH cannot set them", () => {
		expect(
			effectiveSettings({ alertEmails: ["a@abc.com"] }, defaults).alertEmails,
		).toEqual(["a@abc.com"]);
		expect(
			SettingsInput.safeParse({ alertEmails: ["x@evil.com"] }).success,
		).toBe(false);
	});

	it("FR-26: sender must belong to the verified SES identity", () => {
		expect(isSenderAllowed("noreply@watch.hueai.net", "watch.hueai.net")).toBe(
			true,
		);
		expect(isSenderAllowed("a@mail.watch.hueai.net", "watch.hueai.net")).toBe(
			true,
		);
		expect(isSenderAllowed("a@hueai.net", "watch.hueai.net")).toBe(false);
		expect(isSenderAllowed("a@evilwatch.hueai.net", "watch.hueai.net")).toBe(
			false,
		);
	});

	it("FR-26: From header", () => {
		expect(
			fromHeader({ senderName: 'A "B"', senderEmail: "noreply@x.net" }),
		).toBe('"A B" <noreply@x.net>');
	});
});
