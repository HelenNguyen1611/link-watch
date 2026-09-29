import { API_KEY_HEADER, type LinkView } from "@linkwatch/core";
import { createTestDb, type TestDb } from "@linkwatch/core/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";

let t: TestDb;
let app: ReturnType<typeof createApp>;
beforeAll(async () => {
	t = await createTestDb();
	app = createApp({ db: t.db, getApiKey: async () => "k" });
});
afterAll(() => t?.drop());

const call = (path: string, init: RequestInit = {}) =>
	app.request(path, {
		...init,
		headers: {
			[API_KEY_HEADER]: "k",
			"content-type": "application/json",
			...(init.headers ?? {}),
		},
	});
const post = (body: unknown) =>
	call("/api/links", { method: "POST", body: JSON.stringify(body) });

describe("POST /api/links", () => {
	it("FR-01, FR-02, FR-07: thêm link → 201, URL chuẩn hóa, domain chính, trạng thái chờ check", async () => {
		const res = await post({
			url: " HTTPS://Shop.ABC.com/a#x ",
			name: "Trang A",
			tags: ["seo"],
		});
		expect(res.status).toBe(201);
		const link = (await res.json()) as LinkView;
		expect(link).toMatchObject({
			url: "https://shop.abc.com/a",
			domain: "abc.com",
			name: "Trang A",
			tags: ["seo"],
			method: "GET",
			status: "pending",
			paused: false,
		});
		expect(link.id).toMatch(/^[0-9A-Z]{26}$/);
		expect(link).not.toHaveProperty("deletedAt");
	});

	it("FR-02: trùng URL → 409 kèm id link đã có", async () => {
		const res = await post({ url: "https://shop.abc.com/a" });
		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.error).toBe("duplicate");
		expect(body.existingId).toMatch(/^[0-9A-Z]{26}$/);
	});

	it("FR-01: dữ liệu sai → 400 kèm lỗi theo trường", async () => {
		const res = await post({ url: "ftp://abc.com/x", timeoutS: 999 });
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(
			body.issues.map((i: { path: string[] }) => i.path[0]).sort(),
		).toEqual(["timeoutS", "url"]);
	});
});

describe("GET /api/links", () => {
	it("liệt kê link theo trang (limit, cursor)", async () => {
		await post({ url: "https://xyz.vn/1" });
		await post({ url: "https://xyz.vn/2" });
		const all = await (await call("/api/links")).json();
		expect(all.items).toHaveLength(3);
		const page = await (await call("/api/links?limit=2")).json();
		expect(page.items).toHaveLength(2);
		expect(page.cursor).toBeTruthy();
		const rest = await (
			await call(`/api/links?limit=2&cursor=${encodeURIComponent(page.cursor)}`)
		).json();
		expect(rest.items).toHaveLength(1);
		expect(rest.cursor).toBeNull();
	});

	it("limit ngoài 1–100 → 400", async () => {
		expect((await call("/api/links?limit=0")).status).toBe(400);
		expect((await call("/api/links?limit=101")).status).toBe(400);
	});
});

describe("DELETE /api/links/:id", () => {
	it("FR-04: xóa mềm → 204, không còn trong danh sách; xóa lại → 404", async () => {
		const created = (await (
			await post({ url: "https://del.vn/x" })
		).json()) as LinkView;
		expect(
			(await call(`/api/links/${created.id}`, { method: "DELETE" })).status,
		).toBe(204);
		const list = await (await call("/api/links")).json();
		expect(list.items.map((l: LinkView) => l.id)).not.toContain(created.id);
		expect(
			(await call(`/api/links/${created.id}`, { method: "DELETE" })).status,
		).toBe(404);
	});
});
