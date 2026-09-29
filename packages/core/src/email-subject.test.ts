import { describe, expect, it } from "vitest";
import { emailSubject, systemWideOutageSubject } from "./email-subject";

describe("emailSubject — FR-24", () => {
	it("FR-24: incident subject with the domain and broken link count", () => {
		expect(emailSubject("down", "abc.com", 3)).toBe(
			"[LinkWatch][DOWN] abc.com — 3 broken links",
		);
	});

	it("FR-24: singular for one link", () => {
		expect(emailSubject("down", "abc.com", 1)).toBe(
			"[LinkWatch][DOWN] abc.com — 1 broken link",
		);
	});

	it("FR-21: recovery subject", () => {
		expect(emailSubject("recovery", "abc.com", 2)).toBe(
			"[LinkWatch][RECOVERED] abc.com — 2 links back up",
		);
	});

	it("FR-23: reminder subject", () => {
		expect(emailSubject("reminder", "abc.com", 1)).toBe(
			"[LinkWatch][REMINDER] abc.com — 1 link still down",
		);
	});

	it("FR-24: rejects a non-positive link count", () => {
		expect(() => emailSubject("down", "abc.com", 0)).toThrow();
	});

	it("5.2: system-wide outage subject for the admin", () => {
		expect(systemWideOutageSubject(90, 100)).toBe(
			"[LinkWatch][NETWORK] 90/100 links failed in one run — possible LinkWatch network issue",
		);
	});
});
