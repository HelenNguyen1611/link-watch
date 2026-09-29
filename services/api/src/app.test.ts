import { API_KEY_HEADER, LinkInput } from "@linkwatch/core";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";

const SECRET = "bi-mat-thu-nghiem-0123456789";
const app = () => {
	const a = createApp({ getApiKey: async () => SECRET });
	a.post("/_test/zod", async (c) =>
		c.json(LinkInput.parse(await c.req.json())),
	);
	a.get("/_test/boom", () => {
		throw new Error("chi tiết nội bộ");
	});
	return a;
};
const withKey = (key = SECRET): RequestInit => ({
	headers: { [API_KEY_HEADER]: key },
});

describe("API khung", () => {
	it("GET /api/health không cần khóa", async () => {
		const res = await app().request("/api/health");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});

	it("NFR-07 (tạm): thiếu header khóa → 401", async () => {
		const res = await app().request("/api/_test/boom");
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ error: "unauthorized" });
	});

	it("NFR-07 (tạm): sai khóa → 401, kể cả khác độ dài", async () => {
		expect(
			(await app().request("/api/_test/boom", withKey("sai"))).status,
		).toBe(401);
		expect(
			(await app().request("/api/_test/boom", withKey(`${SECRET}x`))).status,
		).toBe(401);
	});

	it("NFR-07 (tạm): chưa cấu hình khóa (rỗng) thì từ chối mọi request, không mở toang", async () => {
		const a = createApp({ getApiKey: async () => "" });
		a.get("/_test/ok", (c) => c.text("ok"));
		const res = await a.request("/api/_test/ok", {
			headers: { [API_KEY_HEADER]: "" },
		});
		expect(res.status).toBe(401);
	});

	it("FR-01: lỗi Zod → 400 kèm chi tiết từng trường", async () => {
		const res = await app().request("/api/_test/zod", {
			method: "POST",
			headers: { [API_KEY_HEADER]: SECRET, "content-type": "application/json" },
			body: JSON.stringify({ url: "ftp://abc.com" }),
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toBe("validation");
		expect(body.issues[0]).toMatchObject({
			path: ["url"],
			params: { code: "unsupported_scheme" },
		});
	});

	it("body không phải JSON → 400", async () => {
		const res = await app().request("/api/_test/zod", {
			method: "POST",
			headers: { [API_KEY_HEADER]: SECRET, "content-type": "application/json" },
			body: "{không phải json",
		});
		expect(res.status).toBe(400);
		expect((await res.json()).error).toBe("invalid_json");
	});

	it("lỗi không lường trước → 500, không lộ chi tiết nội bộ", async () => {
		const res = await app().request("/api/_test/boom", withKey());
		expect(res.status).toBe(500);
		const text = await res.text();
		expect(text).not.toContain("chi tiết nội bộ");
		expect(JSON.parse(text)).toEqual({ error: "internal" });
	});

	it("route không tồn tại → 404 JSON", async () => {
		const res = await app().request("/api/khong-co", withKey());
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: "not_found" });
	});
});
