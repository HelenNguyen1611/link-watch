import { GetItemCommand } from "@aws-sdk/client-dynamodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadScheduleTemplates } from "../usecases/schedules";
import { createTestDb, type TestDb } from "./testing";

let t: TestDb;
beforeAll(async () => {
	t = await createTestDb();
});
afterAll(() => t?.drop());

describe("Schedule entity — FR-12", () => {
	it("FR-12: key SCHED#<id> / META, rule stored as a map", async () => {
		await t.db.Schedule.create({
			id: "every15",
			name: "Every 15 minutes",
			rule: { kind: "interval", minutes: 15 },
		}).go();
		const raw = await t.raw.send(
			new GetItemCommand({
				TableName: t.table,
				Key: { pk: { S: "SCHED#every15" }, sk: { S: "META" } },
			}),
		);
		expect(raw.Item?.rule?.M?.kind?.S).toBe("interval");
		const { data } = await t.db.Schedule.get({ id: "every15" }).go();
		expect(data?.rule).toEqual({ kind: "interval", minutes: 15 });
	});

	it("FR-11 / FR-12: templates load as id → rule; invalid stored rules are skipped", async () => {
		await t.db.Schedule.create({
			id: "default",
			name: "Default",
			rule: { kind: "daily", at: "07:30" },
		}).go();
		await t.db.Schedule.create({
			id: "broken",
			name: "Broken",
			rule: { kind: "interval", minutes: 1 },
		}).go();
		const templates = await loadScheduleTemplates(t.db);
		expect([...templates.keys()].sort()).toEqual(["default", "every15"]);
		expect(templates.get("default")).toEqual({ kind: "daily", at: "07:30" });
	});

	it("FR-12: creating the same id twice is refused", async () => {
		await expect(
			t.db.Schedule.create({
				id: "every15",
				name: "x",
				rule: { kind: "daily", at: "06:00" },
			}).go(),
		).rejects.toThrow();
	});
});
