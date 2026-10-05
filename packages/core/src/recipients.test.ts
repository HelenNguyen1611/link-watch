import { describe, expect, it } from "vitest";
import {
	groupByRecipient,
	resolveRecipients,
	withAlertEmail,
} from "./recipients";

describe("resolveRecipients — FR-20", () => {
	it("FR-20: union of link and domain recipients, link recipients first", () => {
		expect(
			resolveRecipients({
				linkRecipients: ["a@x.com"],
				domainRecipients: ["b@x.com", "c@x.com"],
				defaultAdminEmail: "admin@x.com",
			}),
		).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
	});

	it("FR-20: removes duplicates case-insensitively and trims whitespace", () => {
		expect(
			resolveRecipients({
				linkRecipients: [" A@X.com ", "b@x.com"],
				domainRecipients: ["a@x.com", "B@x.COM"],
			}),
		).toEqual(["a@x.com", "b@x.com"]);
	});

	it("FR-20: does not add the default admin when a list is not empty", () => {
		expect(
			resolveRecipients({
				linkRecipients: [],
				domainRecipients: ["b@x.com"],
				defaultAdminEmail: "admin@x.com",
			}),
		).toEqual(["b@x.com"]);
	});

	it("FR-20: falls back to the default admin email when both lists are empty", () => {
		expect(
			resolveRecipients({
				linkRecipients: [],
				domainRecipients: [],
				defaultAdminEmail: "Admin@X.com",
			}),
		).toEqual(["admin@x.com"]);
	});

	it("FR-20: alert users get every link's alerts, on top of the domain recipients", () => {
		expect(
			resolveRecipients({
				linkRecipients: [],
				domainRecipients: ["b@x.com"],
				defaultAdminEmail: "admin@x.com",
				alertEmails: ["u@x.com", "B@x.com"],
			}),
		).toEqual(["b@x.com", "u@x.com"]);
	});

	it("FR-20: alert users are added to the default admin fallback", () => {
		expect(
			resolveRecipients({
				linkRecipients: [],
				domainRecipients: [],
				defaultAdminEmail: "admin@x.com",
				alertEmails: ["u@x.com", "admin@x.com"],
			}),
		).toEqual(["admin@x.com", "u@x.com"]);
	});

	it("FR-20: no recipients and no admin email → empty list", () => {
		expect(
			resolveRecipients({ linkRecipients: [], domainRecipients: ["  "] }),
		).toEqual([]);
	});
});

describe("groupByRecipient — FR-20, FR-22", () => {
	it("FR-22: each recipient gets only their own links, order kept", () => {
		const items = [
			{ url: "https://abc.com/1", to: ["a@x.com", "b@x.com"] },
			{ url: "https://abc.com/2", to: ["b@x.com"] },
			{ url: "https://abc.com/3", to: ["A@x.com"] },
		];
		const byRecipient = groupByRecipient(items, (i) => i.to);
		expect([...byRecipient.keys()]).toEqual(["a@x.com", "b@x.com"]);
		expect(byRecipient.get("a@x.com")?.map((i) => i.url)).toEqual([
			"https://abc.com/1",
			"https://abc.com/3",
		]);
		expect(byRecipient.get("b@x.com")?.map((i) => i.url)).toEqual([
			"https://abc.com/1",
			"https://abc.com/2",
		]);
	});

	it("FR-20: a duplicated recipient on one item does not repeat the item", () => {
		const byRecipient = groupByRecipient(
			[{ to: ["a@x.com", "A@x.com"] }],
			(i) => i.to,
		);
		expect(byRecipient.get("a@x.com")).toHaveLength(1);
	});
});

describe("withAlertEmail — FR-20", () => {
	it("FR-20: switching on adds the normalized email once, sorted", () => {
		expect(withAlertEmail(["b@x.com"], " A@X.com ", true)).toEqual([
			"a@x.com",
			"b@x.com",
		]);
		expect(withAlertEmail(["a@x.com"], "A@x.com", true)).toEqual(["a@x.com"]);
	});

	it("FR-20: switching off removes it; unknown emails are a no-op", () => {
		expect(withAlertEmail(["a@x.com", "b@x.com"], "A@x.com", false)).toEqual([
			"b@x.com",
		]);
		expect(withAlertEmail(["a@x.com"], "z@x.com", false)).toEqual(["a@x.com"]);
	});
});
