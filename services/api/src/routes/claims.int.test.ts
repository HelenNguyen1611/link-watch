import type { SESv2Client } from "@aws-sdk/client-sesv2";
import type { PriorityJob } from "@linkwatch/core";
import { createTestDb, type TestDb } from "@linkwatch/core/db/testing";
import { hashToken, newToken, tokenTtl } from "@linkwatch/core/token";
import { createLink, getLink, recordCheck } from "@linkwatch/core/usecases";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";

let t: TestDb;
let app: ReturnType<typeof createApp>;
const sent: { job: PriorityJob; delay?: number }[] = [];
beforeAll(async () => {
	t = await createTestDb();
	app = createApp({
		db: t.db,
		auth: { kind: "local", user: { sub: "u1", email: "ops@abc.com" } },
		email: {
			ses: {} as SESv2Client,
			defaults: {
				sesIdentity: "watch.hueai.net",
				senderEmail: "noreply@watch.hueai.net",
			},
		},
		sendPriorityJob: async (job, delay) => {
			sent.push({ job, ...(delay !== undefined && { delay }) });
		},
	});
});
afterAll(() => t?.drop());
beforeEach(() => {
	sent.length = 0;
});

let seq = 0;
async function incidentWithToken(path: string) {
	const now = new Date();
	const link = await createLink(t.db, { url: `https://claims-api.vn/${path}` });
	const fail = { result: "dead" as const, httpCode: 404, responseMs: 10 };
	await recordCheck(t.db, await getLink(t.db, link.id), fail, {
		now: new Date(now.getTime() - 120_000),
		jobId: `a${++seq}`,
	});
	const openedAt = new Date(now.getTime() - 60_000);
	await recordCheck(t.db, await getLink(t.db, link.id), fail, {
		now: openedAt,
		jobId: `a${++seq}`,
	});
	const id = `${link.id}@${openedAt.toISOString()}`;
	const token = newToken();
	await t.db.Token.put({
		tokenHash: hashToken(token),
		incidentIds: [id],
		recipientEmail: "lan@abc.com",
		issuedAt: now.toISOString(),
		ttl: tokenTtl(now),
	}).go();
	return { id, token, link };
}

const req = (path: string, init: RequestInit = {}, auth = true) =>
	app.request(path, {
		...init,
		headers: {
			...(auth && { authorization: "Bearer test" }),
			"content-type": "application/json",
			...(init.headers ?? {}),
		},
	});

describe("public claims API — FR-35, AC-11, AC-12, AC-13", () => {
	it("AC-11: GET with the token needs no sign-in, is not cached and writes nothing", async () => {
		const { id, token } = await incidentWithToken("get");
		const res = await req(`/api/public/claims?token=${token}`, {}, false);
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toContain("no-store");
		expect(await res.json()).toMatchObject({
			status: "open",
			recipient: "lan@abc.com",
		});
		expect(
			(await t.db.Claim.query.byIncident({ incidentId: id }).go()).data,
		).toEqual([]);
		expect(sent).toEqual([]);
	});

	it("FR-36 / AC-13: POST starts one verification; repeated POSTs only return progress", async () => {
		const { token } = await incidentWithToken("post");
		for (let i = 0; i < 5; i++) {
			const res = await req(
				"/api/public/claims",
				{ method: "POST", body: JSON.stringify({ token, note: "Fixed DNS" }) },
				false,
			);
			expect(res.status).toBe(200);
		}
		expect(sent.map((s) => s.delay)).toEqual([0, 120, 300]);
		const last = await (
			await req(`/api/public/claims?token=${token}`, {}, false)
		).json();
		expect(last.items[0].incident.state).toBe("verifying");
		expect(last.items[0].progress).toMatchObject({
			byEmail: "lan@abc.com",
			channel: "email",
			note: "Fixed DNS",
		});
	});

	it("AC-12: unknown token → expired; no job", async () => {
		expect(
			await (await req("/api/public/claims?token=nope", {}, false)).json(),
		).toEqual({ status: "expired" });
		const res = await req(
			"/api/public/claims",
			{ method: "POST", body: JSON.stringify({ token: "nope" }) },
			false,
		);
		expect(await res.json()).toEqual({ status: "expired" });
		expect(sent).toEqual([]);
	});
});

describe("in-app claims — FR-41", () => {
	it("FR-41: POST /api/incidents/resolve-claim for several incidents; the timeline shows who and how", async () => {
		const a = await incidentWithToken("app-a");
		const b = await incidentWithToken("app-b");
		const res = await req("/api/incidents/resolve-claim", {
			method: "POST",
			body: JSON.stringify({ incidentIds: [a.id, b.id], note: "Deployed v2" }),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.items.map((i: { decision: string }) => i.decision)).toEqual([
			"started",
			"started",
		]);
		expect(sent).toHaveLength(6);
		const detail = await (
			await req(`/api/incidents/${encodeURIComponent(a.id)}`)
		).json();
		expect(detail.verifyingBy).toBe("ops@abc.com");
		expect(detail.claims).toEqual([
			expect.objectContaining({
				byEmail: "ops@abc.com",
				channel: "app",
				note: "Deployed v2",
				outcome: "pending",
			}),
		]);
		expect(
			(
				await req("/api/incidents/resolve-claim", {
					method: "POST",
					body: "{}",
				})
			).status,
		).toBe(400);
		expect(
			(
				await req(
					"/api/incidents/resolve-claim",
					{ method: "POST", body: JSON.stringify({ incidentIds: [a.id] }) },
					false,
				)
			).status,
		).toBe(401);
	});
});
