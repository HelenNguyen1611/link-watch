import { GetItemCommand } from "@aws-sdk/client-dynamodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveRecipients } from "../recipients";
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

const emailsOf = async (scope: "DOMAIN" | "LINK", target: string) => {
	const { data } = await db.Recipient.query.byTarget({ scope, target }).go();
	return data.map((r) => r.email);
};

describe("Recipient entity", () => {
	it("SRS 6.2: domain recipient key DOMAIN#<domain> / RCP#<email>", async () => {
		await db.Recipient.create({
			scope: "DOMAIN",
			target: "abc.com",
			email: "lan@abc.com",
			name: "Lan",
		}).go();
		expect(await rawItem("DOMAIN#abc.com", "RCP#lan@abc.com")).toBeDefined();
	});

	it("SRS 6.2: link recipient key LINK#<id> / RCP#<email>", async () => {
		await db.Recipient.create({
			scope: "LINK",
			target: "L1",
			email: "minh@abc.com",
		}).go();
		expect(await rawItem("LINK#L1", "RCP#minh@abc.com")).toBeDefined();
	});

	it("FR-20: email is stored normalized, so a case variant is a duplicate", async () => {
		await db.Recipient.create({
			scope: "DOMAIN",
			target: "norm.com",
			email: "  Hoa@Norm.COM ",
		}).go();
		expect(await emailsOf("DOMAIN", "norm.com")).toEqual(["hoa@norm.com"]);
		await expect(
			db.Recipient.create({
				scope: "DOMAIN",
				target: "norm.com",
				email: "hoa@norm.com",
			}).go(),
		).rejects.toThrow();
	});

	it("FR-20: querying a domain returns only its recipients, not its links or other domains", async () => {
		await db.Link.create({
			domain: "list.com",
			id: "L-list",
			url: "https://list.com/",
			method: "GET",
			expectedCodes: [{ from: 200, to: 399 }],
			timeoutS: 30,
		}).go();
		await db.Recipient.put([
			{ scope: "DOMAIN", target: "list.com", email: "b@list.com" },
			{ scope: "DOMAIN", target: "list.com", email: "a@list.com" },
			{ scope: "DOMAIN", target: "other.com", email: "c@other.com" },
		]).go();
		expect(await emailsOf("DOMAIN", "list.com")).toEqual([
			"a@list.com",
			"b@list.com",
		]);
	});

	it("FR-20: removing a recipient", async () => {
		await db.Recipient.put({
			scope: "LINK",
			target: "L-del",
			email: "x@del.com",
		}).go();
		await db.Recipient.delete({
			scope: "LINK",
			target: "L-del",
			email: "x@del.com",
		}).go();
		expect(await emailsOf("LINK", "L-del")).toEqual([]);
	});

	it("FR-20: link ∪ domain recipients read from the table, deduplicated", async () => {
		await db.Recipient.put([
			{ scope: "DOMAIN", target: "union.com", email: "a@union.com" },
			{ scope: "DOMAIN", target: "union.com", email: "b@union.com" },
			{ scope: "LINK", target: "L-union", email: "b@union.com" },
			{ scope: "LINK", target: "L-union", email: "c@union.com" },
		]).go();
		expect(
			resolveRecipients({
				linkRecipients: await emailsOf("LINK", "L-union"),
				domainRecipients: await emailsOf("DOMAIN", "union.com"),
				defaultAdminEmail: "admin@union.com",
			}),
		).toEqual(["b@union.com", "c@union.com", "a@union.com"]);
	});
});

describe("Settings entity", () => {
	it("FR-20: no settings item yet → get returns null (callers use defaults)", async () => {
		const { data } = await db.Settings.get({}).go();
		expect(data).toBeNull();
	});

	it("FR-20, FR-23, FR-26: key SETTINGS / META, reads the default admin email and defaults", async () => {
		await db.Settings.put({
			defaultAdminEmail: "admin@abc.com",
			senderEmail: "alerts@watch.hueai.net",
		}).go();
		expect(await rawItem("SETTINGS", "META")).toBeDefined();
		const { data } = await db.Settings.get({}).go();
		expect(data).toMatchObject({
			defaultAdminEmail: "admin@abc.com",
			senderEmail: "alerts@watch.hueai.net",
			senderName: "LinkWatch",
			remindersEnabled: true,
			reminderIntervalHours: 24,
		});
	});

	it("FR-20: the default admin email is used when no recipients exist", async () => {
		const { data } = await db.Settings.get({}).go();
		expect(
			resolveRecipients({
				linkRecipients: await emailsOf("LINK", "L-none"),
				domainRecipients: await emailsOf("DOMAIN", "none.com"),
				defaultAdminEmail: data?.defaultAdminEmail,
			}),
		).toEqual(["admin@abc.com"]);
	});

	it("FR-23: reminder interval is configurable and can be turned off", async () => {
		await db.Settings.patch({})
			.set({ reminderIntervalHours: 6, remindersEnabled: false })
			.go();
		const { data } = await db.Settings.get({}).go();
		expect(data).toMatchObject({
			reminderIntervalHours: 6,
			remindersEnabled: false,
		});
	});

	it("FR-23: a non-positive reminder interval is rejected", async () => {
		await expect(
			db.Settings.patch({}).set({ reminderIntervalHours: 0 }).go(),
		).rejects.toThrow();
	});
});
