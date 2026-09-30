import type { SESv2Client } from "@aws-sdk/client-sesv2";
import type { PriorityJob } from "@linkwatch/core";
import { createTestDb, type TestDb } from "@linkwatch/core/db/testing";
import { createLink } from "@linkwatch/core/usecases";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";

let t: TestDb;
const sent: PriorityJob[] = [];
const email = {
	ses: {} as SESv2Client,
	defaults: {
		sesIdentity: "watch.hueai.net",
		senderEmail: "noreply@watch.hueai.net",
	},
};
const appWith = (withQueue = true) =>
	createApp({
		db: t.db,
		auth: { kind: "local", user: { sub: "u1", email: "helen@wootech.co" } },
		email,
		...(withQueue && {
			sendPriorityJob: async (job: PriorityJob) => {
				sent.push(job);
			},
		}),
	});
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
	t = await createTestDb();
	app = appWith();
});
afterAll(() => t?.drop());
beforeEach(() => {
	sent.length = 0;
});

const call = (path: string, init: RequestInit = {}) =>
	app.request(path, {
		...init,
		headers: {
			authorization: "Bearer test",
			"content-type": "application/json",
			...(init.headers ?? {}),
		},
	});
const OPENED = "2026-09-29T23:04:00.000Z";

describe("Incidents API — FR-19", () => {
	let id: string;
	beforeAll(async () => {
		const link = await createLink(t.db, { url: "https://inc.vn/a" });
		await t.db.Incident.create({
			linkId: link.id,
			openedAt: OPENED,
			domain: link.domain,
			url: link.url,
			type: "dead",
			httpCode: 404,
		}).go();
		id = `${link.id}@${OPENED}`;
	});

	it("FR-19: GET /api/incidents lists active incidents by default", async () => {
		const res = await call("/api/incidents");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.items.map((i: { id: string }) => i.id)).toContain(id);
		expect(body.cursor).toBeNull();
	});

	it("FR-19: GET /api/incidents/:id with an URL-encoded id, including the emails sent", async () => {
		const res = await call(`/api/incidents/${encodeURIComponent(id)}`);
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			id,
			state: "open",
			url: "https://inc.vn/a",
			notifications: [],
		});
	});

	it("FR-19: POST /api/incidents/:id/ack records the signed-in user and the note", async () => {
		const res = await call(`/api/incidents/${encodeURIComponent(id)}/ack`, {
			method: "POST",
			body: JSON.stringify({ note: "On it" }),
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			ackedBy: "helen@wootech.co",
			note: "On it",
		});
	});

	it("FR-19: acknowledging a closed incident → 409; unknown id → 404; bad state filter → 400", async () => {
		await t.db.Incident.patch({
			linkId: id.split("@")[0] as string,
			openedAt: OPENED,
		})
			.set({ state: "closed", closedAt: "2026-09-30T00:00:00.000Z" })
			.go();
		const closed = await call(`/api/incidents/${encodeURIComponent(id)}/ack`, {
			method: "POST",
		});
		expect(closed.status).toBe(409);
		expect((await closed.json()).error).toBe("incident_closed");
		expect((await call("/api/incidents/nope")).status).toBe(404);
		expect((await call("/api/incidents?state=weird")).status).toBe(400);
		const list = await call("/api/incidents?state=closed");
		expect(
			(await list.json()).items.map((i: { id: string }) => i.id),
		).toContain(id);
	});
});

describe("Link history API — FR-17, FR-18", () => {
	it("FR-18: GET /api/links/:id, /checks, /uptime, /incidents", async () => {
		const link = await createLink(t.db, { url: "https://hist-api.vn/a" });
		await t.db.Check.put({
			linkId: link.id,
			checkedAt: "2026-09-29T23:00:00.000Z",
			result: "up",
			httpCode: 200,
			responseMs: 120,
		}).go();
		const one = await call(`/api/links/${link.id}`);
		expect(await one.json()).toMatchObject({ id: link.id, url: link.url });
		const checks = await call(`/api/links/${link.id}/checks?limit=10`);
		expect((await checks.json()).items).toEqual([
			{
				checkedAt: "2026-09-29T23:00:00.000Z",
				result: "up",
				httpCode: 200,
				responseMs: 120,
			},
		]);
		const uptime = await call(`/api/links/${link.id}/uptime?days=7`);
		expect((await uptime.json()).days).toHaveLength(7);
		const incidents = await call(`/api/links/${link.id}/incidents`);
		expect((await incidents.json()).items).toEqual([]);
		expect((await call("/api/links/NOPE/checks")).status).toBe(404);
	});
});

describe("Check now API — FR-16", () => {
	it("FR-16: POST /api/links/check-now queues check_now jobs → 202", async () => {
		const a = await createLink(t.db, { url: "https://cn.vn/1" });
		const b = await createLink(t.db, { url: "https://cn.vn/2" });
		const res = await call("/api/links/check-now", {
			method: "POST",
			body: JSON.stringify({ linkIds: [a.id, b.id, "MISSING"] }),
		});
		expect(res.status).toBe(202);
		expect(await res.json()).toEqual({
			queued: [a.id, b.id],
			skipped: [{ id: "MISSING", reason: "not_found" }],
			jobs: 1,
		});
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({
			kind: "check_now",
			domain: "cn.vn",
			linkIds: [a.id, b.id],
		});
	});

	it("FR-16: a whole domain", async () => {
		const res = await call("/api/links/check-now", {
			method: "POST",
			body: JSON.stringify({ domain: "cn.vn" }),
		});
		expect(res.status).toBe(202);
		expect((await res.json()).queued).toHaveLength(2);
	});

	it("FR-16: invalid body → 400; no priority queue (local API) → 503", async () => {
		const bad = await call("/api/links/check-now", {
			method: "POST",
			body: JSON.stringify({}),
		});
		expect(bad.status).toBe(400);
		app = appWith(false);
		const res = await call("/api/links/check-now", {
			method: "POST",
			body: JSON.stringify({ domain: "cn.vn" }),
		});
		expect(res.status).toBe(503);
		expect((await res.json()).error).toBe("check_now_unavailable");
		app = appWith();
	});
});
