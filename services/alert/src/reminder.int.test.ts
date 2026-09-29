import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { SQSClient } from "@aws-sdk/client-sqs";
import { incidentId } from "@linkwatch/core";
import { createTestDb, type TestDb } from "@linkwatch/core/db/testing";
import { mockClient } from "aws-sdk-client-mock";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHandler } from "./handler";

const sesMock = mockClient(SESv2Client);
let t: TestDb;
beforeAll(async () => {
	t = await createTestDb();
});
afterAll(() => t?.drop());
beforeEach(() => {
	sesMock.reset();
	sesMock.on(SendEmailCommand).resolves({ MessageId: "ses-id" });
});

const HOUR = 3_600_000;
const OPENED = "2026-09-29T23:04:00.000Z";
const after = (ms: number) => new Date(Date.parse(OPENED) + ms);

const run = (now: Date) =>
	createHandler({
		db: t.db,
		ses: new SESv2Client({}),
		sqs: new SQSClient({}),
		alertQueueUrl: "https://sqs.local/alert",
		config: {
			appUrl: "https://watch.hueai.net",
			defaults: {
				sesIdentity: "watch.hueai.net",
				senderEmail: "noreply@watch.hueai.net",
				defaultAdminEmail: "admin@linkwatch.test",
			},
		},
		sleep: async () => {},
		now: () => now,
	})({ kind: "reminders" });

const emails = () =>
	sesMock.commandCalls(SendEmailCommand).map((c) => ({
		to: c.args[0].input.Destination?.ToAddresses,
		subject: c.args[0].input.Content?.Simple?.Subject?.Data,
	}));

async function incident(linkId: string, partial: Record<string, unknown> = {}) {
	await t.db.Incident.create({
		linkId,
		openedAt: OPENED,
		domain: "remind.vn",
		url: `https://remind.vn/${linkId}`,
		type: "dead",
		httpCode: 404,
		downNotifiedAt: OPENED,
		...partial,
	}).go();
}

describe("Reminders — FR-23", () => {
	it("FR-23: open 24 hours, not acknowledged → 1 reminder; acknowledged → none", async () => {
		await incident("R1");
		await incident("R2", {
			ackedAt: after(HOUR).toISOString(),
			ackedBy: "a@b.c",
		});

		expect(await run(after(23 * HOUR))).toEqual({ reminded: 0 });
		expect(emails()).toEqual([]);

		expect(await run(after(24 * HOUR))).toEqual({ reminded: 1 });
		expect(emails()).toEqual([
			{
				to: ["admin@linkwatch.test"],
				subject: "[LinkWatch][REMINDER] remind.vn — 1 link still down",
			},
		]);
		const log = await t.db.Notification.query
			.byIncident({ incidentId: incidentId("R1", OPENED) })
			.go();
		expect(log.data.map((n) => n.kind)).toEqual(["reminder"]);
	});

	it("FR-23: the next reminder comes one interval after the previous one", async () => {
		expect(await run(after(25 * HOUR))).toEqual({ reminded: 0 });
		expect(await run(after(48 * HOUR))).toEqual({ reminded: 1 });
	});

	it("FR-23: interval configurable in Settings, and reminders can be turned off", async () => {
		await t.db.Settings.put({ reminderIntervalHours: 6 }).go();
		expect(await run(after(54 * HOUR))).toEqual({ reminded: 1 });
		await t.db.Settings.patch({}).set({ remindersEnabled: false }).go();
		expect(await run(after(100 * HOUR))).toEqual({ reminded: 0 });
		await t.db.Settings.patch({}).set({ remindersEnabled: true }).go();
	});

	it("FR-23: closed incidents and incidents never announced (5.2 step 5) are not reminded", async () => {
		await t.db.Incident.patch({ linkId: "R1", openedAt: OPENED })
			.set({ state: "closed", closedAt: after(101 * HOUR).toISOString() })
			.go();
		await incident("R3", { downNotifiedAt: undefined });
		sesMock.resetHistory();
		expect(await run(after(200 * HOUR))).toEqual({ reminded: 0 });
		expect(emails()).toEqual([]);
	});
});
