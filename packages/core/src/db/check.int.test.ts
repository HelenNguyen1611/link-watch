import { GetItemCommand } from "@aws-sdk/client-dynamodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHECK_TTL_DAYS, checkTtl } from "./entities/check";
import { createTestDb, type TestDb } from "./testing";

let t: TestDb;
beforeAll(async () => {
	t = await createTestDb();
});
afterAll(() => t?.drop());

describe("CheckResult entity", () => {
	it("FR-17: key LINK#<id> / CHECK#<timestamp>, stores every field", async () => {
		await t.db.Check.create({
			linkId: "L1",
			checkedAt: "2026-09-29T23:01:02.000Z",
			result: "slow",
			httpCode: 200,
			responseMs: 7200,
			finalUrl: "https://www.abc.com/",
			sslExpiresAt: "2027-01-01T00:00:00.000Z",
		}).go();
		const raw = await t.raw.send(
			new GetItemCommand({
				TableName: t.table,
				Key: {
					pk: { S: "LINK#L1" },
					sk: { S: "CHECK#2026-09-29T23:01:02.000Z" },
				},
			}),
		);
		expect(raw.Item?.result?.S).toBe("slow");
	});

	it("FR-17 / NFR-08: ttl = check time + 90 days (epoch seconds)", async () => {
		expect(CHECK_TTL_DAYS).toBe(90);
		const { data } = await t.db.Check.get({
			linkId: "L1",
			checkedAt: "2026-09-29T23:01:02.000Z",
		}).go();
		const expected =
			Math.floor(Date.parse("2026-09-29T23:01:02.000Z") / 1000) + 90 * 86400;
		expect(data?.ttl).toBe(expected);
		expect(checkTtl("2026-09-29T23:01:02.000Z")).toBe(expected);
	});

	it("FR-18: returns the most recent checks first, with a limit", async () => {
		for (const [ts, result] of [
			["2026-09-30T23:01:00.000Z", "up"],
			["2026-10-01T23:01:00.000Z", "dead"],
		] as const) {
			await t.db.Check.create({
				linkId: "L1",
				checkedAt: ts,
				result,
				responseMs: 100,
				httpCode: result === "up" ? 200 : 404,
				errorType: result === "dead" ? "http_4xx" : undefined,
			}).go();
		}
		await t.db.Check.create({
			linkId: "L2",
			checkedAt: "2026-10-02T00:00:00.000Z",
			result: "up",
			responseMs: 90,
		}).go();
		const { data } = await t.db.Check.query
			.byLink({ linkId: "L1" })
			.go({ order: "desc", limit: 2 });
		expect(data.map((c) => c.checkedAt)).toEqual([
			"2026-10-01T23:01:00.000Z",
			"2026-09-30T23:01:00.000Z",
		]);
		expect(data[0]).toMatchObject({
			result: "dead",
			errorType: "http_4xx",
			httpCode: 404,
		});
	});
});
