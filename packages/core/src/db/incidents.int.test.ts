import { GetItemCommand } from "@aws-sdk/client-dynamodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { incidentId } from "../incident";
import { DAY_STAT_TTL_DAYS, dayStatTtl } from "./entities/day-stat";
import type { Db } from "./index";
import { createTestDb, type TestDb } from "./testing";

let t: TestDb;
let db: Db;

beforeAll(async () => {
	t = await createTestDb();
	db = t.db;
});
afterAll(() => t?.drop());

const rawItem = async (pk: string, sk: string) => {
	const r = await t.raw.send(
		new GetItemCommand({
			TableName: t.table,
			Key: { pk: { S: pk }, sk: { S: sk } },
		}),
	);
	return r.Item;
};

const openIncident = (linkId: string, openedAt: string, domain = "abc.com") =>
	db.Incident.create({
		linkId,
		openedAt,
		domain,
		url: `https://${domain}/${linkId}`,
		type: "dead",
		httpCode: 404,
	}).go();

describe("Incident entity", () => {
	it("SRS 6.2: key LINK#<id> / INC#<opened_at>, state open by default, no ttl (NFR-08)", async () => {
		await openIncident("L1", "2026-09-29T23:04:00.000Z");
		const item = await rawItem("LINK#L1", "INC#2026-09-29T23:04:00.000Z");
		expect(item?.state?.S).toBe("open");
		expect(item?.gsi2pk?.S).toBe("INC#open");
		expect(item?.ttl).toBeUndefined();
	});

	it("GSI2: lists open incidents oldest first", async () => {
		await openIncident("L2", "2026-09-29T23:02:00.000Z", "xyz.vn");
		await openIncident("L3", "2026-09-29T23:06:00.000Z");
		const { data } = await db.Incident.query.byState({ state: "open" }).go();
		expect(data.map((i) => i.linkId)).toEqual(["L2", "L1", "L3"]);
	});

	it("5.2 step 4 + GSI2: closing moves the incident out of the open list", async () => {
		await db.Incident.patch({
			linkId: "L1",
			openedAt: "2026-09-29T23:04:00.000Z",
		})
			.set({
				state: "closed",
				closedAt: "2026-09-29T23:34:00.000Z",
				closedReason: "recovered",
				downtimeMs: 30 * 60_000,
			})
			.go();
		const open = await db.Incident.query.byState({ state: "open" }).go();
		expect(open.data.map((i) => i.linkId)).toEqual(["L2", "L3"]);
		const closed = await db.Incident.query.byState({ state: "closed" }).go();
		expect(closed.data).toHaveLength(1);
		expect(closed.data[0]).toMatchObject({
			linkId: "L1",
			domain: "abc.com",
			downtimeMs: 1_800_000,
			closedReason: "recovered",
		});
	});

	it("5.2: finds the latest incident of a link", async () => {
		await openIncident("L1", "2026-10-01T23:04:00.000Z");
		const { data } = await db.Incident.query
			.primary({ linkId: "L1" })
			.go({ order: "desc", limit: 1 });
		expect(data[0]?.openedAt).toBe("2026-10-01T23:04:00.000Z");
		expect(data[0]?.state).toBe("open");
	});

	it("5.2: creating the same incident twice is rejected (SQS retry safety)", async () => {
		await expect(
			openIncident("L2", "2026-09-29T23:02:00.000Z", "xyz.vn"),
		).rejects.toThrow();
	});
});

describe("DayStat entity", () => {
	const record = (result: "up" | "dead", responseMs: number) =>
		db.DayStat.update({ linkId: "L1", day: "2026-09-30" })
			.add({ checks: 1, [result]: 1, totalResponseMs: responseMs })
			.set({ ttl: dayStatTtl("2026-09-30") })
			.go();

	it("SRS 6.2: key LINK#<id> / DAY#<date>, counters add up atomically", async () => {
		await Promise.all([
			record("up", 100),
			record("up", 300),
			record("dead", 50),
		]);
		expect(await rawItem("LINK#L1", "DAY#2026-09-30")).toBeDefined();
		const { data } = await db.DayStat.get({
			linkId: "L1",
			day: "2026-09-30",
		}).go();
		expect(data).toMatchObject({
			checks: 3,
			up: 2,
			dead: 1,
			totalResponseMs: 450,
		});
	});

	it("NFR-08: ttl = day + 2 years (epoch seconds)", async () => {
		const { data } = await db.DayStat.get({
			linkId: "L1",
			day: "2026-09-30",
		}).go();
		expect(DAY_STAT_TTL_DAYS).toBeGreaterThanOrEqual(730);
		expect(data?.ttl).toBe(
			Date.parse("2026-09-30T00:00:00.000Z") / 1000 +
				DAY_STAT_TTL_DAYS * 86_400,
		);
	});
});

describe("Notification entity", () => {
	const id = incidentId("L2", "2026-09-29T23:02:00.000Z");

	it("FR-25: key INC#<id> / MAIL#<sent_at>#<to>, logs recipient, time and status", async () => {
		await db.Notification.create({
			incidentId: id,
			sentAt: "2026-09-29T23:07:00.000Z",
			to: "a@xyz.vn",
			kind: "down",
			status: "sent",
			messageId: "ses-1",
		}).go();
		await db.Notification.create({
			incidentId: id,
			sentAt: "2026-09-29T23:07:00.000Z",
			to: "b@xyz.vn",
			kind: "down",
			status: "failed",
			retries: 3,
			error: "Throttling",
		}).go();
		expect(
			await rawItem(`INC#${id}`, "MAIL#2026-09-29T23:07:00.000Z#a@xyz.vn"),
		).toBeDefined();
		const { data } = await db.Notification.query
			.byIncident({ incidentId: id })
			.go();
		expect(data.map((n) => [n.to, n.status, n.retries])).toEqual([
			["a@xyz.vn", "sent", 0],
			["b@xyz.vn", "failed", 3],
		]);
	});
});
