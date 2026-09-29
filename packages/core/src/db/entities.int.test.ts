import { GetItemCommand } from "@aws-sdk/client-dynamodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./index";
import { createTestDb, type TestDb } from "./testing";

let t: TestDb;
let db: Db;

beforeAll(async () => {
	t = await createTestDb();
	db = t.db;
});
afterAll(() => t?.drop());

const rawKeys = async (pk: string, sk: string) => {
	const r = await t.raw.send(
		new GetItemCommand({
			TableName: t.table,
			Key: { pk: { S: pk }, sk: { S: sk } },
		}),
	);
	return r.Item;
};

describe("Domain entity", () => {
	it("SRS 6.2: key DOMAIN#<name> / META, reads back every FR-08 field", async () => {
		await db.Domain.create({
			name: "abc.com.vn",
			displayName: "ABC",
			owner: "lan@abc.com.vn",
		}).go();
		const item = await rawKeys("DOMAIN#abc.com.vn", "META");
		expect(item).toBeDefined();
		const { data } = await db.Domain.get({ name: "abc.com.vn" }).go();
		expect(data).toMatchObject({
			name: "abc.com.vn",
			displayName: "ABC",
			owner: "lan@abc.com.vn",
			enabled: true,
			slowAlert: false,
			ignoreWaf403: false,
			status: "normal",
		});
		expect(data?.createdAt).toMatch(/^\d{4}-\d\d-\d\dT/);
	});

	it("FR-08: creating a duplicate domain is rejected", async () => {
		await expect(
			db.Domain.create({ name: "abc.com.vn" }).go(),
		).rejects.toThrow();
	});
});

describe("Link entity", () => {
	const base = {
		domain: "xyz.vn",
		method: "GET" as const,
		expectedCodes: [{ from: 200, to: 399 }],
		timeoutS: 30,
		tags: [],
	};

	it("SRS 6.2: key DOMAIN#<domain> / LINK#<id>, default values", async () => {
		await db.Link.create({ ...base, id: "L1", url: "https://xyz.vn/a" }).go();
		expect(await rawKeys("DOMAIN#xyz.vn", "LINK#L1")).toBeDefined();
		const { data } = await db.Link.get({ domain: "xyz.vn", id: "L1" }).go();
		expect(data).toMatchObject({
			url: "https://xyz.vn/a",
			status: "pending",
			paused: false,
		});
	});

	it("SRS 6.2 GSI1: fetches due links (next_run_at ≤ now) ordered by time", async () => {
		await db.Link.create({
			...base,
			id: "D1",
			url: "https://xyz.vn/d1",
			nextRunAt: "2026-09-29T23:03:00.000Z",
		}).go();
		await db.Link.create({
			...base,
			id: "D2",
			url: "https://xyz.vn/d2",
			nextRunAt: "2026-09-29T23:01:00.000Z",
		}).go();
		await db.Link.create({
			...base,
			id: "D3",
			url: "https://xyz.vn/d3",
			nextRunAt: "2026-09-30T23:00:00.000Z",
		}).go();
		const { data } = await db.Link.query
			.due({})
			.lte({ nextRunAt: "2026-09-29T23:05:00.000Z" })
			.go();
		expect(data.map((l) => l.id)).toEqual(["D2", "D1"]);
	});

	it("FR-04 + GSI1: a paused link (no next_run_at) is not in the due list", async () => {
		await db.Link.patch({ domain: "xyz.vn", id: "D1" })
			.set({ paused: true })
			.remove(["nextRunAt"])
			.go();
		const { data } = await db.Link.query
			.due({})
			.lte({ nextRunAt: "2026-09-29T23:05:00.000Z" })
			.go();
		expect(data.map((l) => l.id)).toEqual(["D2"]);
		await db.Link.patch({ domain: "xyz.vn", id: "D1" })
			.set({ paused: false, nextRunAt: "2026-09-29T23:04:00.000Z" })
			.go();
		const again = await db.Link.query
			.due({})
			.lte({ nextRunAt: "2026-09-29T23:05:00.000Z" })
			.go();
		expect(again.data.map((l) => l.id)).toEqual(["D2", "D1"]);
	});

	it("GSI3: looks up a link by id without knowing its domain", async () => {
		const { data } = await db.Link.query.byId({ id: "L1" }).go();
		expect(data).toHaveLength(1);
		expect(data[0]).toMatchObject({
			domain: "xyz.vn",
			url: "https://xyz.vn/a",
		});
	});

	it("GSI3: lists every link and every domain page by page", async () => {
		const links = await db.Link.query.byId({}).go({ pages: "all" });
		expect(links.data.map((l) => l.id).sort()).toEqual([
			"D1",
			"D2",
			"D3",
			"L1",
		]);
		const page = await db.Link.query.byId({}).go({ limit: 2 });
		expect(page.data).toHaveLength(2);
		expect(page.cursor).toBeTruthy();
		const domains = await db.Domain.query.all({}).go({ pages: "all" });
		expect(domains.data.map((d) => d.name)).toEqual(["abc.com.vn"]);
	});

	it("FR-01: stores expected codes as a list of ranges, tags, keyword", async () => {
		await db.Link.create({
			...base,
			id: "K1",
			url: "https://xyz.vn/k",
			expectedCodes: [
				{ from: 200, to: 299 },
				{ from: 301, to: 301 },
			],
			tags: ["seo"],
			keyword: "Liên hệ",
		}).go();
		const { data } = await db.Link.get({ domain: "xyz.vn", id: "K1" }).go();
		expect(data).toMatchObject({
			expectedCodes: [
				{ from: 200, to: 299 },
				{ from: 301, to: 301 },
			],
			tags: ["seo"],
			keyword: "Liên hệ",
		});
	});
});
