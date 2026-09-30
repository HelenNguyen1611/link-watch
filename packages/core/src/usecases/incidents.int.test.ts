import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dayStatTtl } from "../db/entities/day-stat";
import { createTestDb, type TestDb } from "../db/testing";
import { incidentId } from "../incident";
import type { PriorityJob } from "../queue";
import { checkNow } from "./check-now";
import { linkChecks, linkIncidents, linkUptime } from "./history";
import {
	acknowledgeIncident,
	getIncident,
	IncidentClosedError,
	IncidentNotFoundError,
	listIncidents,
} from "./incidents";
import { createLink, deleteLink, LinkNotFoundError } from "./links";

let t: TestDb;
beforeAll(async () => {
	t = await createTestDb();
});
afterAll(() => t?.drop());

const NOW = new Date("2026-09-30T03:00:00.000Z"); // 10:00 Vietnam time

async function incident(
	linkId: string,
	openedAt: string,
	partial: Record<string, unknown> = {},
) {
	await t.db.Incident.create({
		linkId,
		openedAt,
		domain: "abc.com",
		url: `https://abc.com/${linkId}`,
		type: "dead",
		httpCode: 404,
		errorType: "http_4xx",
		...partial,
	}).go();
	return incidentId(linkId, openedAt);
}

describe("incidents — FR-19", () => {
	it("FR-19: active = open + verifying, newest first; closed paged separately", async () => {
		await incident("I1", "2026-09-29T01:00:00.000Z");
		await incident("I2", "2026-09-29T03:00:00.000Z", { state: "verifying" });
		await incident("I3", "2026-09-29T02:00:00.000Z", {
			state: "closed",
			closedAt: "2026-09-29T02:30:00.000Z",
			downtimeMs: 1_800_000,
		});
		const active = await listIncidents(t.db, { state: "active" });
		expect(active.items.map((i) => i.linkId)).toEqual(["I2", "I1"]);
		expect(active.items[1]).toMatchObject({
			id: "I1@2026-09-29T01:00:00.000Z",
			url: "https://abc.com/I1",
			type: "dead",
			state: "open",
			httpCode: 404,
			errorType: "http_4xx",
		});
		const closed = await listIncidents(t.db, { state: "closed" });
		expect(closed.items.map((i) => i.linkId)).toEqual(["I3"]);
		expect(closed.items[0]?.downtimeMs).toBe(1_800_000);
	});

	it("FR-19: detail lists who received which email (MAIL# log)", async () => {
		const id = incidentId("I1", "2026-09-29T01:00:00.000Z");
		await t.db.Notification.put([
			{
				incidentId: id,
				sentAt: "2026-09-29T01:05:00.000Z",
				to: "lan@abc.com",
				kind: "down",
				status: "sent",
			},
			{
				incidentId: id,
				sentAt: "2026-09-29T01:05:00.000Z",
				to: "x@abc.com",
				kind: "down",
				status: "failed",
				retries: 3,
				error: "MessageRejected",
			},
		]).go();
		const detail = await getIncident(t.db, id);
		expect(detail.notifications).toEqual([
			{
				to: "lan@abc.com",
				kind: "down",
				status: "sent",
				sentAt: "2026-09-29T01:05:00.000Z",
			},
			{
				to: "x@abc.com",
				kind: "down",
				status: "failed",
				sentAt: "2026-09-29T01:05:00.000Z",
				error: "MessageRejected",
			},
		]);
	});

	it("FR-19: unknown or malformed id → not found", async () => {
		await expect(getIncident(t.db, "nope")).rejects.toBeInstanceOf(
			IncidentNotFoundError,
		);
		await expect(
			getIncident(t.db, "X@2020-01-01T00:00:00.000Z"),
		).rejects.toBeInstanceOf(IncidentNotFoundError);
	});

	it("FR-19 / FR-23: acknowledge records who, when and a note; again updates the note, keeps the first time", async () => {
		const id = incidentId("I1", "2026-09-29T01:00:00.000Z");
		const acked = await acknowledgeIncident(
			t.db,
			id,
			{ note: " Deploying a fix " },
			{ by: "helen@wootech.co", now: NOW },
		);
		expect(acked).toMatchObject({
			ackedBy: "helen@wootech.co",
			ackedAt: NOW.toISOString(),
			note: "Deploying a fix",
			state: "open",
		});
		const again = await acknowledgeIncident(
			t.db,
			id,
			{ note: "Fixed on staging" },
			{ by: "ops@abc.com", now: new Date("2026-09-30T04:00:00.000Z") },
		);
		expect(again).toMatchObject({
			ackedBy: "ops@abc.com",
			ackedAt: NOW.toISOString(),
			note: "Fixed on staging",
		});
		const cleared = await acknowledgeIncident(
			t.db,
			id,
			{ note: "" },
			{
				by: "ops@abc.com",
			},
		);
		expect(cleared.note).toBeUndefined();
	});

	it("FR-19: a closed incident cannot be acknowledged", async () => {
		await expect(
			acknowledgeIncident(
				t.db,
				incidentId("I3", "2026-09-29T02:00:00.000Z"),
				{},
				{ by: "a@b.co" },
			),
		).rejects.toBeInstanceOf(IncidentClosedError);
	});
});

describe("link history — FR-17, FR-18", () => {
	it("FR-18: last checks newest first, with a limit; 404 for a deleted link", async () => {
		const link = await createLink(
			t.db,
			{ url: "https://hist.vn/a" },
			{ now: NOW },
		);
		for (const [i, result] of (["up", "slow", "dead"] as const).entries())
			await t.db.Check.put({
				linkId: link.id,
				checkedAt: `2026-09-2${7 + i}T00:00:00.000Z`,
				result,
				responseMs: 100 * (i + 1),
				...(result === "dead" && {
					httpCode: 404,
					errorType: "http_4xx" as const,
				}),
			}).go();
		const checks = await linkChecks(t.db, link.id, 2);
		expect(checks).toEqual([
			{
				checkedAt: "2026-09-29T00:00:00.000Z",
				result: "dead",
				responseMs: 300,
				httpCode: 404,
				errorType: "http_4xx",
			},
			{
				checkedAt: "2026-09-28T00:00:00.000Z",
				result: "slow",
				responseMs: 200,
			},
		]);

		const gone = await createLink(
			t.db,
			{ url: "https://hist.vn/gone" },
			{ now: NOW },
		);
		await deleteLink(t.db, gone.id, { now: NOW });
		await expect(linkChecks(t.db, gone.id)).rejects.toBeInstanceOf(
			LinkNotFoundError,
		);
	});

	it("FR-18: 30-day uptime from the daily counters (Vietnam days)", async () => {
		const link = await createLink(
			t.db,
			{ url: "https://hist.vn/up" },
			{ now: NOW },
		);
		for (const [day, up, dead] of [
			["2026-09-30", 3, 1],
			["2026-09-15", 2, 0],
			["2026-08-01", 0, 5],
		] as const)
			await t.db.DayStat.update({ linkId: link.id, day })
				.add({
					checks: up + dead,
					up,
					dead,
					totalResponseMs: 100 * (up + dead),
				})
				.set({ ttl: dayStatTtl(day) })
				.go();
		const s = await linkUptime(t.db, link.id, { now: NOW });
		expect(s.days).toHaveLength(30);
		expect(s.checks).toBe(6);
		expect(s.uptimePct).toBeCloseTo(83.33, 2);
		expect(s.days.at(-1)).toMatchObject({ day: "2026-09-30", uptimePct: 75 });
	});

	it("FR-18: incidents of one link, newest first", async () => {
		await incident("I4", "2026-09-20T00:00:00.000Z", {
			state: "closed",
			closedAt: "2026-09-20T01:00:00.000Z",
		});
		await incident("I4", "2026-09-25T00:00:00.000Z");
		const link = await t.db.Link.create({
			domain: "abc.com",
			id: "I4",
			url: "https://abc.com/I4",
			method: "GET",
			expectedCodes: [{ from: 200, to: 399 }],
			timeoutS: 30,
		}).go();
		expect(link.data.id).toBe("I4");
		const list = await linkIncidents(t.db, "I4");
		expect(list.map((i) => i.openedAt)).toEqual([
			"2026-09-25T00:00:00.000Z",
			"2026-09-20T00:00:00.000Z",
		]);
	});
});

describe("check now — FR-16", () => {
	it("FR-16: chosen links → check_now jobs per domain; paused and unknown links skipped", async () => {
		const a = await createLink(
			t.db,
			{ url: "https://now-a.vn/1" },
			{ now: NOW },
		);
		const b = await createLink(
			t.db,
			{ url: "https://now-b.vn/1" },
			{ now: NOW },
		);
		const p = await createLink(
			t.db,
			{ url: "https://now-a.vn/paused" },
			{ now: NOW },
		);
		await t.db.Link.patch({ domain: p.domain, id: p.id })
			.set({ paused: true })
			.remove(["nextRunAt"])
			.go();
		const sent: PriorityJob[] = [];
		const res = await checkNow(
			t.db,
			{ linkIds: [a.id, b.id, p.id, "UNKNOWN"] },
			{ send: async (job) => void sent.push(job), now: NOW },
		);
		expect(res).toEqual({
			queued: [a.id, b.id],
			skipped: [
				{ id: p.id, reason: "paused" },
				{ id: "UNKNOWN", reason: "not_found" },
			],
			jobs: 2,
		});
		expect(sent).toEqual([
			{
				kind: "check_now",
				domain: "now-a.vn",
				linkIds: [a.id],
				dueAt: NOW.toISOString(),
			},
			{
				kind: "check_now",
				domain: "now-b.vn",
				linkIds: [b.id],
				dueAt: NOW.toISOString(),
			},
		]);
	});

	it("FR-16: a whole domain, deleted links left out", async () => {
		const x1 = await createLink(
			t.db,
			{ url: "https://whole.vn/1" },
			{ now: NOW },
		);
		const x2 = await createLink(
			t.db,
			{ url: "https://whole.vn/2" },
			{ now: NOW },
		);
		const x3 = await createLink(
			t.db,
			{ url: "https://whole.vn/3" },
			{ now: NOW },
		);
		await deleteLink(t.db, x3.id, { now: NOW });
		const sent: PriorityJob[] = [];
		const res = await checkNow(
			t.db,
			{ domain: "whole.vn" },
			{ send: async (job) => void sent.push(job), now: NOW },
		);
		expect(res.queued.sort()).toEqual([x1.id, x2.id].sort());
		expect(sent).toHaveLength(1);
	});

	it("FR-16: exactly one of linkIds or domain", async () => {
		await expect(
			checkNow(t.db, {}, { send: async () => {} }),
		).rejects.toThrow();
		await expect(
			checkNow(
				t.db,
				{ linkIds: ["a"], domain: "x.vn" },
				{ send: async () => {} },
			),
		).rejects.toThrow();
	});
});
