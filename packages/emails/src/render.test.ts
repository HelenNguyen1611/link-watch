import { describe, expect, it } from "vitest";
import { formatDuration, formatTime, incidentUrl } from "./format";
import {
	renderIncidentEmail,
	renderOutageEmail,
	renderRecoveryEmail,
	renderReminderEmail,
	renderTestEmail,
} from "./render";
import type { IncidentItem } from "./types";

const APP = "https://watch.hueai.net";
const items: IncidentItem[] = [
	{
		incidentId: "L1@2026-09-29T23:04:00.000Z",
		url: "https://abc.com/pricing",
		type: "dead",
		errorType: "http_4xx",
		httpCode: 404,
		detectedAt: "2026-09-29T23:04:00.000Z",
	},
	{
		incidentId: "L2@2026-09-29T23:05:00.000Z",
		url: "https://shop.abc.com/",
		type: "down",
		errorType: "timeout",
		detectedAt: "2026-09-29T23:05:00.000Z",
	},
	{
		incidentId: "L3@2026-09-29T23:06:00.000Z",
		url: "https://abc.com/blog",
		type: "down",
		errorType: "http_5xx",
		httpCode: 503,
		detectedAt: "2026-09-29T23:06:00.000Z",
	},
];

describe("renderIncidentEmail — FR-21, FR-22, FR-24", () => {
	it("FR-24: subject [LinkWatch][DOWN] abc.com — 3 broken links", async () => {
		const email = await renderIncidentEmail({
			domain: "abc.com",
			items,
			appUrl: APP,
		});
		expect(email.subject).toBe("[LinkWatch][DOWN] abc.com — 3 broken links");
	});

	it("FR-22 / FR-24: lists every URL with error type, HTTP code, detection time and incident link", async () => {
		const { html, text } = await renderIncidentEmail({
			domain: "abc.com",
			items,
			appUrl: APP,
		});
		for (const item of items) {
			expect(text).toContain(item.url);
			expect(html).toContain(
				incidentUrl(APP, item.incidentId).replaceAll("&", "&amp;"),
			);
		}
		expect(text).toContain("Dead link");
		expect(text).toContain("Client error (4xx)");
		expect(text).toContain("HTTP code: 404");
		expect(text).toContain("Timed out");
		expect(text).toContain("2026-09-30 06:04 (GMT+7)");
		expect(text).not.toContain("HTTP code: undefined");
	});

	it("FR-24: HTML and text snapshots", async () => {
		const email = await renderIncidentEmail({
			domain: "abc.com",
			items,
			appUrl: APP,
		});
		expect(email.html).toMatchSnapshot("html");
		expect(email.text).toMatchSnapshot("text");
	});
});

describe("renderRecoveryEmail — FR-21", () => {
	it("AC-07: recovery email shows the downtime", async () => {
		const email = await renderRecoveryEmail({
			domain: "abc.com",
			appUrl: APP,
			items: [
				{
					incidentId: "L1@2026-09-29T23:04:00.000Z",
					url: "https://abc.com/pricing",
					recoveredAt: "2026-09-30T00:09:00.000Z",
					downtimeMs: 65 * 60_000,
				},
			],
		});
		expect(email.subject).toBe(
			"[LinkWatch][RECOVERED] abc.com — 1 link back up",
		);
		expect(email.text).toContain("Downtime: 1 h 5 min");
		expect(email.text).toContain("https://abc.com/pricing");
		expect(email.html).toMatchSnapshot("html");
		expect(email.text).toMatchSnapshot("text");
	});
});

describe("renderReminderEmail — FR-23", () => {
	it("FR-23: reminder subject, interval and how long each incident has been open", async () => {
		const email = await renderReminderEmail({
			domain: "abc.com",
			appUrl: APP,
			items: items.slice(0, 1),
			intervalHours: 24,
			now: "2026-09-30T23:04:00.000Z",
		});
		expect(email.subject).toBe(
			"[LinkWatch][REMINDER] abc.com — 1 link still down",
		);
		expect(email.text).toContain("in the last 24 hours");
		expect(email.text).toContain("Open for: 1 d");
		expect(email.text).toMatchSnapshot("text");
	});
});

describe("format helpers", () => {
	it("FR-21: durations", () => {
		expect(formatDuration(20_000)).toBe("< 1 min");
		expect(formatDuration(45 * 60_000)).toBe("45 min");
		expect(formatDuration(120 * 60_000)).toBe("2 h");
		expect(formatDuration((3 * 24 + 4) * 3_600_000)).toBe("3 d 4 h");
	});

	it("FR-24: times in Asia/Saigon", () => {
		expect(formatTime("2026-09-29T17:30:00.000Z")).toBe(
			"2026-09-30 00:30 (GMT+7)",
		);
	});

	it("static export: incident page uses a query string", () => {
		expect(incidentUrl(`${APP}/`, "L1@2026-09-29T23:04:00.000Z")).toBe(
			`${APP}/incidents/?id=L1%402026-09-29T23%3A04%3A00.000Z`,
		);
	});
});

describe("renderOutageEmail — SRS 5.2 step 5", () => {
	it("5.2: admin notice with the failed/checked counts", async () => {
		const email = await renderOutageEmail({
			dispatchedAt: "2026-09-29T23:00:00.000Z",
			checked: 100,
			failed: 92,
		});
		expect(email.subject).toBe(
			"[LinkWatch][NETWORK] 92/100 links failed in one run — possible LinkWatch network issue",
		);
		expect(email.text).toContain("92 of 100 links failed in the same run");
		expect(email.text).toContain("2026-09-30 06:00 (GMT+7)");
	});
});

describe("renderTestEmail — FR-26", () => {
	it("FR-26: names the sender and who asked for it", async () => {
		const email = await renderTestEmail({
			sender: "noreply@watch.hueai.net",
			requestedBy: "helen@wootech.co",
		});
		expect(email.subject).toBe("[LinkWatch] Test email");
		expect(email.text).toContain("sent from noreply@watch.hueai.net");
		expect(email.text).toContain("Requested by helen@wootech.co.");
	});
});
