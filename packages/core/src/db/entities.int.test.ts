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
	it("SRS 6.2: khóa DOMAIN#<tên> / META, đọc lại đủ trường FR-08", async () => {
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

	it("FR-08: tạo trùng domain bị từ chối", async () => {
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

	it("SRS 6.2: khóa DOMAIN#<domain> / LINK#<id>, giá trị mặc định", async () => {
		await db.Link.create({ ...base, id: "L1", url: "https://xyz.vn/a" }).go();
		expect(await rawKeys("DOMAIN#xyz.vn", "LINK#L1")).toBeDefined();
		const { data } = await db.Link.get({ domain: "xyz.vn", id: "L1" }).go();
		expect(data).toMatchObject({
			url: "https://xyz.vn/a",
			status: "pending",
			paused: false,
		});
	});

	it("SRS 6.2 GSI1: lấy link đến hạn (next_run_at ≤ hiện tại), sắp theo thời gian", async () => {
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

	it("FR-04 + GSI1: link tạm dừng (không có next_run_at) không nằm trong danh sách đến hạn", async () => {
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

	it("GSI3: tra link theo id không cần biết domain", async () => {
		const { data } = await db.Link.query.byId({ id: "L1" }).go();
		expect(data).toHaveLength(1);
		expect(data[0]).toMatchObject({
			domain: "xyz.vn",
			url: "https://xyz.vn/a",
		});
	});

	it("GSI3: liệt kê mọi link và mọi domain theo trang", async () => {
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

	it("FR-01: lưu mã mong đợi dạng danh sách khoảng, tag, keyword", async () => {
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
