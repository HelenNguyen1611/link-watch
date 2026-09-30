import type { SESv2Client } from "@aws-sdk/client-sesv2";
import { parseCsv } from "@linkwatch/core";
import { createTestDb, type TestDb } from "@linkwatch/core/db/testing";
import { createLink } from "@linkwatch/core/usecases";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";

let t: TestDb;
let app: ReturnType<typeof createApp>;
beforeAll(async () => {
	t = await createTestDb();
	app = createApp({
		db: t.db,
		auth: { kind: "local", user: { sub: "u1", email: "helen@wootech.co" } },
		email: {
			ses: {} as SESv2Client,
			defaults: {
				sesIdentity: "watch.hueai.net",
				senderEmail: "noreply@watch.hueai.net",
			},
		},
	});
});
afterAll(() => t?.drop());

const call = (path: string, init: RequestInit = {}) =>
	app.request(path, {
		...init,
		headers: {
			authorization: "Bearer test",
			"content-type": "application/json",
			...(init.headers ?? {}),
		},
	});
const json = (method: string, body: unknown): RequestInit => ({
	method,
	body: JSON.stringify(body),
});

describe("Link management API — FR-03, FR-04, FR-05", () => {
	it("FR-04: PATCH /api/links/:id edits a link; duplicate URL → 409; unknown → 404; bad field → 400", async () => {
		const a = await createLink(t.db, { url: "https://mgmt.vn/a" });
		await createLink(t.db, { url: "https://mgmt.vn/b" });
		const res = await call(
			`/api/links/${a.id}`,
			json("PATCH", { name: "Home", timeoutS: 12 }),
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			id: a.id,
			name: "Home",
			timeoutS: 12,
		});
		expect(
			(
				await call(
					`/api/links/${a.id}`,
					json("PATCH", { url: "https://mgmt.vn/b" }),
				)
			).status,
		).toBe(409);
		expect(
			(await call("/api/links/NOPE", json("PATCH", { name: "x" }))).status,
		).toBe(404);
		expect(
			(await call(`/api/links/${a.id}`, json("PATCH", { timeoutS: 999 })))
				.status,
		).toBe(400);
	});

	it("FR-04: POST /api/links/bulk pause, resume and delete", async () => {
		const a = await createLink(t.db, { url: "https://bulk-api.vn/a" });
		const b = await createLink(t.db, { url: "https://bulk-api.vn/b" });
		const paused = await call(
			"/api/links/bulk",
			json("POST", { action: "pause", ids: [a.id, b.id] }),
		);
		expect(await paused.json()).toEqual({
			updated: [a.id, b.id],
			notFound: [],
		});
		expect((await (await call(`/api/links/${a.id}`)).json()).paused).toBe(true);
		await call(
			"/api/links/bulk",
			json("POST", { action: "resume", ids: [a.id] }),
		);
		expect((await (await call(`/api/links/${a.id}`)).json()).paused).toBe(
			false,
		);
		const deleted = await call(
			"/api/links/bulk",
			json("POST", { action: "delete", ids: [b.id, "NOPE"] }),
		);
		expect(await deleted.json()).toEqual({
			updated: [b.id],
			notFound: ["NOPE"],
		});
		expect(
			(
				await call(
					"/api/links/bulk",
					json("POST", { action: "archive", ids: [a.id] }),
				)
			).status,
		).toBe(400);
		expect(
			(
				await call(
					"/api/links/bulk",
					json("POST", { action: "pause", ids: [] }),
				)
			).status,
		).toBe(400);
	});

	it("FR-03 / AC-01: import preview then commit", async () => {
		const text =
			"url,name\nhttps://a.imp.com/x,A\nhttps://b.imp.com/y,B\nnot-a-url,C\n";
		const preview = await call(
			"/api/links/import/preview",
			json("POST", { text }),
		);
		expect(preview.status).toBe(200);
		expect((await preview.json()).summary).toEqual({
			valid: 2,
			duplicate: 0,
			error: 1,
		});
		const commit = await call("/api/links/import", json("POST", { text }));
		expect(commit.status).toBe(201);
		const body = await commit.json();
		expect(body.created).toHaveLength(2);
		expect(body.rejected).toHaveLength(1);
		const again = await call(
			"/api/links/import/preview",
			json("POST", { text }),
		);
		expect((await again.json()).summary).toEqual({
			valid: 0,
			duplicate: 2,
			error: 1,
		});
	});

	it("FR-03: more than 25 rows in one commit → 400 import_too_large", async () => {
		const text = Array.from(
			{ length: 26 },
			(_, i) => `https://many.vn/${i}`,
		).join("\n");
		const res = await call("/api/links/import", json("POST", { text }));
		expect(res.status).toBe(400);
		expect((await res.json()).error).toBe("import_too_large");
	});

	it("FR-05: GET /api/links/export.csv downloads every link with its status", async () => {
		const res = await call("/api/links/export.csv");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/csv");
		expect(res.headers.get("content-disposition")).toMatch(
			/attachment; filename="linkwatch-links-\d{4}-\d\d-\d\d\.csv"/,
		);
		const rows = parseCsv(await res.text());
		expect(rows[0]?.[0]).toBe("url");
		expect(rows.slice(1).map((r) => r[0])).toContain("https://a.imp.com/x");
		// Deleted links are not exported.
		expect(rows.slice(1).map((r) => r[0])).not.toContain(
			"https://bulk-api.vn/b",
		);
	});

	it("step 19b: POST /api/links/fresh returns current rows by key, without deleted links", async () => {
		const a = await createLink(t.db, { url: "https://fresh-api.vn/a" });
		const res = await call(
			"/api/links/fresh",
			json("POST", [
				{ domain: a.domain, id: a.id },
				{ domain: "nope.vn", id: "NOPE" },
			]),
		);
		expect(res.status).toBe(200);
		expect((await res.json()).items.map((l: { id: string }) => l.id)).toEqual([
			a.id,
		]);
		expect((await call("/api/links/fresh", json("POST", []))).status).toBe(400);
	});

	it("step 19b: GET /api/links/snapshot — built on the fly when no snapshot is stored (local)", async () => {
		const res = await call("/api/links/snapshot");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.stored).toBe(false);
		expect(body.items.map((l: { url: string }) => l.url)).toContain(
			"https://a.imp.com/x",
		);
	});
});
