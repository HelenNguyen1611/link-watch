import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../db/testing";
import {
	createLink,
	DuplicateLinkError,
	deleteLink,
	LinkNotFoundError,
	listLinks,
} from "./links";

let t: TestDb;
beforeAll(async () => {
	t = await createTestDb();
});
afterAll(() => t?.drop());

const now = new Date("2026-09-29T10:00:00.000Z");

describe("createLink", () => {
	it("AC-01: 3 link a.abc.com/x, b.abc.com/y, xyz.vn → 2 domain abc.com (2 link) và xyz.vn (1 link)", async () => {
		for (const url of [
			"https://a.abc.com/x",
			"https://b.abc.com/y",
			"https://xyz.vn",
		]) {
			await createLink(t.db, { url }, { now });
		}
		const domains = await t.db.Domain.query.all({}).go({ pages: "all" });
		expect(domains.data.map((d) => d.name).sort()).toEqual([
			"abc.com",
			"xyz.vn",
		]);
		const abc = await t.db.Link.query
			.primary({ domain: "abc.com" })
			.go({ pages: "all" });
		const xyz = await t.db.Link.query
			.primary({ domain: "xyz.vn" })
			.go({ pages: "all" });
		expect(abc.data).toHaveLength(2);
		expect(xyz.data.map((l) => l.url)).toEqual(["https://xyz.vn/"]);
	});

	it("FR-02: URL được chuẩn hóa trước khi lưu; FR-01: áp giá trị mặc định", async () => {
		const link = await createLink(
			t.db,
			{ url: "  HTTPS://Shop.ABC.com/p#top ", tags: ["seo"] },
			{ now },
		);
		expect(link).toMatchObject({
			url: "https://shop.abc.com/p",
			domain: "abc.com",
			method: "GET",
			expectedCodes: [{ from: 200, to: 399 }],
			timeoutS: 30,
			tags: ["seo"],
			status: "pending",
			paused: false,
		});
	});

	it("link mới được check ở lượt Dispatcher kế tiếp (next_run_at = lúc tạo)", async () => {
		const link = await createLink(
			t.db,
			{ url: "https://new.abc.com/" },
			{ now },
		);
		expect(link.nextRunAt).toBe(now.toISOString());
		const due = await t.db.Link.query
			.due({})
			.lte({ nextRunAt: now.toISOString() })
			.go({ pages: "all" });
		expect(due.data.map((l) => l.id)).toContain(link.id);
	});

	it("FR-02: chặn trùng lặp theo URL đã chuẩn hóa", async () => {
		await expect(
			createLink(t.db, { url: "https://A.abc.com/x#dup" }, { now }),
		).rejects.toBeInstanceOf(DuplicateLinkError);
	});

	it("FR-02: hai request đồng thời cùng URL chỉ tạo được 1 link", async () => {
		const results = await Promise.allSettled([
			createLink(t.db, { url: "https://race.vn/x" }, { now }),
			createLink(t.db, { url: "https://race.vn/x" }, { now }),
		]);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		const links = await t.db.Link.query
			.primary({ domain: "race.vn" })
			.go({ pages: "all" });
		expect(links.data).toHaveLength(1);
	});

	it("FR-07: domain đã có thì không bị ghi đè", async () => {
		await t.db.Domain.patch({ name: "xyz.vn" })
			.set({ displayName: "XYZ" })
			.go();
		await createLink(t.db, { url: "https://xyz.vn/moi" }, { now });
		const { data } = await t.db.Domain.get({ name: "xyz.vn" }).go();
		expect(data?.displayName).toBe("XYZ");
	});

	it("FR-01: dữ liệu sai ném lỗi Zod, không ghi gì", async () => {
		await expect(
			createLink(t.db, { url: "ftp://bad.vn/" }, { now }),
		).rejects.toThrow();
		const { data } = await t.db.Domain.get({ name: "bad.vn" }).go();
		expect(data).toBeNull();
	});
});

describe("listLinks / deleteLink", () => {
	it("liệt kê mọi link chưa xóa, theo trang", async () => {
		const all = await listLinks(t.db, { limit: 100 });
		expect(all.items.length).toBe(7);
		const page = await listLinks(t.db, { limit: 3 });
		expect(page.items).toHaveLength(3);
		const next = await listLinks(t.db, { limit: 100, cursor: page.cursor });
		expect(next.items).toHaveLength(4);
	});

	it("FR-04: xóa mềm — không còn trong danh sách, không còn đến hạn, vẫn còn bản ghi", async () => {
		const link = await createLink(t.db, { url: "https://del.vn/a" }, { now });
		await deleteLink(t.db, link.id, { now });
		const list = await listLinks(t.db, { limit: 100 });
		expect(list.items.map((l) => l.id)).not.toContain(link.id);
		const due = await t.db.Link.query
			.due({})
			.lte({ nextRunAt: "2100-01-01T00:00:00.000Z" })
			.go({ pages: "all" });
		expect(due.data.map((l) => l.id)).not.toContain(link.id);
		const { data } = await t.db.Link.get({
			domain: "del.vn",
			id: link.id,
		}).go();
		expect(data?.deletedAt).toBe(now.toISOString());
	});

	it("FR-04 + FR-02: link đã xóa thì thêm lại được cùng URL", async () => {
		const again = await createLink(t.db, { url: "https://del.vn/a" }, { now });
		expect(again.url).toBe("https://del.vn/a");
	});

	it("FR-04: xóa link không tồn tại hoặc đã xóa → LinkNotFoundError", async () => {
		await expect(deleteLink(t.db, "KHONGCO", { now })).rejects.toBeInstanceOf(
			LinkNotFoundError,
		);
		const link = await createLink(t.db, { url: "https://del.vn/b" }, { now });
		await deleteLink(t.db, link.id, { now });
		await expect(deleteLink(t.db, link.id, { now })).rejects.toBeInstanceOf(
			LinkNotFoundError,
		);
	});
});
