import { API_KEY_HEADER, LinkInput } from "@linkwatch/core";
import type { Db } from "@linkwatch/core/db";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";

const SECRET = "bi-mat-thu-nghiem-0123456789";
const app = () => {
	const a = createApp({ db: {} as Db, getApiKey: async () => SECRET });
	a.post("/_test/zod", async (c) =>
		c.json(LinkInput.parse(await c.req.json())),
	);
	a.get("/_test/boom", () => {
		throw new Error("internal detail");
	});
	return a;
};
const withKey = (key = SECRET): RequestInit => ({
	headers: { [API_KEY_HEADER]: key },
});

describe("API khung", () => {
	it("GET /api/health needs no key", async () => {
		const res = await app().request("/api/health");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});

	it("NFR-07 (temporary): missing key header → 401", async () => {
		const res = await app().request("/api/_test/boom");
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ error: "unauthorized" });
	});

	it("NFR-07 (temporary): wrong key → 401, including different length", async () => {
		expect(
			(await app().request("/api/_test/boom", withKey("sai"))).status,
		).toBe(401);
		expect(
			(await app().request("/api/_test/boom", withKey(`${SECRET}x`))).status,
		).toBe(401);
	});

	it("NFR-07 (temporary): unconfigured (empty) key rejects every request instead of failing open", async () => {
		const a = createApp({ db: {} as Db, getApiKey: async () => "" });
		a.get("/_test/ok", (c) => c.text("ok"));
		const res = await a.request("/api/_test/ok", {
			headers: { [API_KEY_HEADER]: "" },
		});
		expect(res.status).toBe(401);
	});

	it("FR-01: Zod error → 400 with per-field details", async () => {
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

	it("non-JSON body → 400", async () => {
		const res = await app().request("/api/_test/zod", {
			method: "POST",
			headers: { [API_KEY_HEADER]: SECRET, "content-type": "application/json" },
			body: "{not json",
		});
		expect(res.status).toBe(400);
		expect((await res.json()).error).toBe("invalid_json");
	});

	it("unexpected error → 500 without leaking internal details", async () => {
		const res = await app().request("/api/_test/boom", withKey());
		expect(res.status).toBe(500);
		const text = await res.text();
		expect(text).not.toContain("internal detail");
		expect(JSON.parse(text)).toEqual({ error: "internal" });
	});

	it("unknown route → 404 JSON", async () => {
		const res = await app().request("/api/does-not-exist", withKey());
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: "not_found" });
	});
});

describe("CORS (local development only)", () => {
	it("with corsOrigins: OPTIONS preflight passes without a key and allows the key header", async () => {
		const a = createApp({
			db: {} as Db,
			getApiKey: async () => SECRET,
			corsOrigins: ["http://localhost:3000"],
		});
		const res = await a.request("/api/links", {
			method: "OPTIONS",
			headers: {
				origin: "http://localhost:3000",
				"access-control-request-method": "POST",
				"access-control-request-headers": `${API_KEY_HEADER},content-type`,
			},
		});
		expect(res.status).toBe(204);
		expect(res.headers.get("access-control-allow-origin")).toBe(
			"http://localhost:3000",
		);
		expect(
			res.headers.get("access-control-allow-headers")?.toLowerCase(),
		).toContain(API_KEY_HEADER);
	});

	it("by default (production, same origin via CloudFront) no CORS headers are sent", async () => {
		const res = await app().request("/api/health", {
			headers: { origin: "https://evil.example" },
		});
		expect(res.headers.get("access-control-allow-origin")).toBeNull();
	});
});
