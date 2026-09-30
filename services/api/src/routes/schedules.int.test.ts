import type { SESv2Client } from "@aws-sdk/client-sesv2";
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

describe("Schedules API — FR-11, FR-12, FR-13", () => {
	it("FR-12: create, list, rename; invalid → 400", async () => {
		const created = await call(
			"/api/schedules",
			json("POST", {
				name: "Every 15",
				rule: { kind: "interval", minutes: 15 },
			}),
		);
		expect(created.status).toBe(201);
		const { id } = await created.json();
		const list = await (await call("/api/schedules")).json();
		expect(list.items[0].id).toBe("default");
		expect(list.items.map((s: { id: string }) => s.id)).toContain(id);
		const renamed = await call(
			`/api/schedules/${id}`,
			json("PATCH", { name: "Quarter" }),
		);
		expect((await renamed.json()).name).toBe("Quarter");
		expect(
			(
				await call(
					"/api/schedules",
					json("POST", { name: "bad", rule: { kind: "interval", minutes: 7 } }),
				)
			).status,
		).toBe(400);
		expect(
			(await call("/api/schedules/NOPE", json("PATCH", { name: "x" }))).status,
		).toBe(404);
	});

	it("FR-13: assign to a domain and a link; a schedule in use → 409 on delete; default → 400", async () => {
		const link = await createLink(t.db, { url: "https://sched-api.vn/a" });
		const { id } = await (
			await call(
				"/api/schedules",
				json("POST", { name: "Daily 9", rule: { kind: "daily", at: "09:00" } }),
			)
		).json();
		const dom = await call(
			"/api/domains/sched-api.vn",
			json("PATCH", { scheduleId: id, displayName: "Sched" }),
		);
		expect(dom.status).toBe(200);
		expect(await dom.json()).toMatchObject({
			scheduleId: id,
			displayName: "Sched",
		});
		const ln = await call(
			`/api/links/${link.id}`,
			json("PATCH", { scheduleId: id }),
		);
		expect((await ln.json()).id).toBe(link.id);
		const del = await call(`/api/schedules/${id}`, { method: "DELETE" });
		expect(del.status).toBe(409);
		expect(await del.json()).toMatchObject({
			error: "schedule_in_use",
			usedBy: { domains: 1, links: 1 },
		});
		expect(
			(await call("/api/schedules/default", { method: "DELETE" })).status,
		).toBe(400);
		expect(
			(
				await call(
					"/api/domains/sched-api.vn",
					json("PATCH", { scheduleId: "NOPE" }),
				)
			).status,
		).toBe(404);
		expect((await call("/api/domains/nope.vn")).status).toBe(404);
	});
});
