import http from "node:http";
import type { AddressInfo } from "node:net";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { ProbeResult } from "@linkwatch/core";
import { checkTtl } from "@linkwatch/core/db";
import { createTestDb, type TestDb } from "@linkwatch/core/db/testing";
import { createLink, deleteLink } from "@linkwatch/core/usecases";
import type { SQSEvent, SQSRecord } from "aws-lambda";
import { mockClient } from "aws-sdk-client-mock";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHandler } from "./handler";

let t: TestDb;
let server: http.Server;
let base: string;

beforeAll(async () => {
	t = await createTestDb();
	server = http.createServer((req, res) => {
		const code = Number.parseInt(req.url?.slice(1) ?? "", 10) || 200;
		res.writeHead(code).end("ok");
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
	await new Promise((r) => server.close(r));
	await t?.drop();
});

const now = new Date("2026-09-29T23:02:00.000Z"); // 06:02 Vietnam time
const record = (body: unknown, id = Math.random().toString(36)): SQSRecord =>
	({
		messageId: id,
		body: typeof body === "string" ? body : JSON.stringify(body),
	}) as SQSRecord;
const event = (...records: SQSRecord[]): SQSEvent => ({ Records: records });
const job = (domain: string, linkIds: string[]) => ({
	kind: "scheduled",
	domain,
	linkIds,
	dispatchedAt: now.toISOString(),
});
const handler = () =>
	createHandler({
		db: t.db,
		now: () => now,
		probeOptions: { allowPrivate: true },
	});

describe("Checker handler", () => {
	it("FR-17 + 5.2: first 404 → suspect, writes 1 check record with ttl, updates the latest check", async () => {
		const link = await createLink(t.db, { url: `${base}/404` }, { now });
		const res = await handler()(event(record(job(link.domain, [link.id]))));
		expect(res.batchItemFailures).toEqual([]);

		const checks = await t.db.Check.query.byLink({ linkId: link.id }).go();
		expect(checks.data).toHaveLength(1);
		expect(checks.data[0]).toMatchObject({
			result: "dead",
			httpCode: 404,
			errorType: "http_4xx",
			checkedAt: now.toISOString(),
			ttl: checkTtl(now.toISOString()),
		});
		const { data } = await t.db.Link.get({
			domain: link.domain,
			id: link.id,
		}).go();
		expect(data).toMatchObject({
			status: "suspect",
			lastCheckedAt: now.toISOString(),
			lastHttpCode: 404,
			lastErrorType: "http_4xx",
		});
	});

	it("FR-11: after a check, next_run_at = 06:00 next day + jitter (default schedule)", async () => {
		const link = await createLink(t.db, { url: `${base}/200` }, { now });
		await handler()(event(record(job(link.domain, [link.id]))));
		const { data } = await t.db.Link.get({
			domain: link.domain,
			id: link.id,
		}).go();
		expect(data?.status).toBe("up");
		expect(data?.lastErrorType).toBeUndefined();
		const next = Date.parse(data?.nextRunAt ?? "");
		expect(next).toBeGreaterThanOrEqual(Date.parse("2026-09-30T23:00:00.000Z"));
		expect(next).toBeLessThan(Date.parse("2026-09-30T23:05:00.000Z"));
	});

	it("FR-17: a link that failed and then recovers clears the old error type", async () => {
		const link = await createLink(t.db, { url: `${base}/503` }, { now });
		await handler()(event(record(job(link.domain, [link.id]))));
		await t.db.Link.patch({ domain: link.domain, id: link.id })
			.set({ url: `${base}/200` })
			.go();
		await handler()(event(record(job(link.domain, [link.id]))));
		const { data } = await t.db.Link.get({
			domain: link.domain,
			id: link.id,
		}).go();
		expect(data).toMatchObject({ status: "up", lastHttpCode: 200 });
		expect(data?.lastErrorType).toBeUndefined();
	});

	it("FR-04: deleted or paused links are skipped and no check is written", async () => {
		const del = await createLink(t.db, { url: `${base}/200?del` }, { now });
		await deleteLink(t.db, del.id, { now });
		const paused = await createLink(
			t.db,
			{ url: `${base}/200?paused` },
			{ now },
		);
		await t.db.Link.patch({ domain: paused.domain, id: paused.id })
			.set({ paused: true })
			.remove(["nextRunAt"])
			.go();
		const res = await handler()(
			event(record(job(del.domain, [del.id, paused.id, "KHONGCO"]))),
		);
		expect(res.batchItemFailures).toEqual([]);
		expect(
			(await t.db.Check.query.byLink({ linkId: del.id }).go()).data,
		).toEqual([]);
		expect(
			(await t.db.Check.query.byLink({ linkId: paused.id }).go()).data,
		).toEqual([]);
		const { data } = await t.db.Link.get({
			domain: paused.domain,
			id: paused.id,
		}).go();
		expect(data?.nextRunAt).toBeUndefined();
	});

	it("FR-14 / NFR-09: at most 2 concurrent requests per domain", async () => {
		const ids: string[] = [];
		for (let i = 0; i < 6; i++)
			ids.push(
				(await createLink(t.db, { url: `${base}/200?c=${i}` }, { now })).id,
			);
		let active = 0;
		let peak = 0;
		const slowProbe = async (): Promise<ProbeResult> => {
			active++;
			peak = Math.max(peak, active);
			await new Promise((r) => setTimeout(r, 30));
			active--;
			return {
				httpCode: 200,
				responseMs: 30,
				redirectCount: 0,
				finalUrl: base,
			};
		};
		const h = createHandler({ db: t.db, now: () => now, probe: slowProbe });
		await h(
			event(
				record(job("127.0.0.1", ids.slice(0, 3))),
				record(job("127.0.0.1", ids.slice(3))),
			),
		);
		expect(peak).toBe(2);
	});

	it("NFR-04: a failed message and every message after it (same FIFO batch) are returned for retry → DLQ", async () => {
		const a = await createLink(t.db, { url: `${base}/200?a` }, { now });
		const b = await createLink(t.db, { url: `${base}/200?b` }, { now });
		const res = await handler()(
			event(
				record(job(a.domain, [a.id]), "m1"),
				record("{not json", "m2"),
				record(job(b.domain, [b.id]), "m3"),
			),
		);
		expect(res.batchItemFailures).toEqual([
			{ itemIdentifier: "m2" },
			{ itemIdentifier: "m3" },
		]);
		expect(
			(await t.db.Check.query.byLink({ linkId: a.id }).go()).data,
		).toHaveLength(1);
		expect(
			(await t.db.Check.query.byLink({ linkId: b.id }).go()).data,
		).toHaveLength(0);
	});

	it("NFR-07: links pointing at private addresses are blocked by default → dead link (blocked_private_address)", async () => {
		const link = await createLink(t.db, { url: `${base}/200?ssrf` }, { now });
		await createHandler({ db: t.db, now: () => now })(
			event(record(job(link.domain, [link.id]))),
		);
		const { data } = await t.db.Link.get({
			domain: link.domain,
			id: link.id,
		}).go();
		expect(data).toMatchObject({
			status: "suspect",
			lastErrorType: "blocked_private_address",
		});
	});
});

describe("Checker handler — retry", () => {
	it("NFR-04 + 5.2: SQS redelivering the same message is recorded once (no double-counted failure)", async () => {
		const link = await createLink(t.db, { url: `${base}/404?retry` }, { now });
		let probes = 0;
		const h = createHandler({
			db: t.db,
			now: () => now,
			probe: async () => {
				probes++;
				return { httpCode: 404, responseMs: 10, redirectCount: 0 };
			},
		});
		const msg = record(job(link.domain, [link.id]), "same-message");
		expect((await h(event(msg))).batchItemFailures).toEqual([]);
		expect((await h(event(msg))).batchItemFailures).toEqual([]);
		expect(probes).toBe(1);
		const { data } = await t.db.Link.get({
			domain: link.domain,
			id: link.id,
		}).go();
		expect(data?.status).toBe("suspect");
		const stat = await t.db.DayStat.get({
			linkId: link.id,
			day: "2026-09-30",
		}).go();
		expect(stat.data?.checks).toBe(1);
		expect(
			(await t.db.Incident.query.primary({ linkId: link.id }).go()).data,
		).toEqual([]);
	});
});

describe("Checker handler — incidents (5.2)", () => {
	const at = (iso: string) => new Date(iso);
	const checkAt = (domain: string, id: string, when: Date) =>
		createHandler({
			db: t.db,
			now: () => when,
			probeOptions: { allowPrivate: true },
		})(event(record(job(domain, [id]))));
	const incidents = async (linkId: string) =>
		(await t.db.Incident.query.primary({ linkId }).go()).data;

	it("AC-04: 404 twice in a row → exactly 1 open dead-link incident", async () => {
		const link = await createLink(t.db, { url: `${base}/404?ac04` }, { now });
		await checkAt(link.domain, link.id, at("2026-09-29T23:02:00.000Z"));
		expect(await incidents(link.id)).toEqual([]);
		await checkAt(link.domain, link.id, at("2026-09-29T23:04:00.000Z"));
		const list = await incidents(link.id);
		expect(list).toHaveLength(1);
		expect(list[0]).toMatchObject({
			state: "open",
			type: "dead",
			openedAt: "2026-09-29T23:04:00.000Z",
			domain: link.domain,
			url: link.url,
			httpCode: 404,
		});
		const { data } = await t.db.Link.get({
			domain: link.domain,
			id: link.id,
		}).go();
		expect(data?.status).toBe("dead");
		// 5.2 step 3: recheck after 10 minutes (23:14); next_run_at is the Dispatcher fallback 5 minutes later (PLAN Q2).
		expect(data?.nextRunAt).toBe("2026-09-29T23:19:00.000Z");

		// A third failure keeps the same incident.
		await checkAt(link.domain, link.id, at("2026-09-29T23:14:00.000Z"));
		expect(await incidents(link.id)).toHaveLength(1);
		const open = await t.db.Incident.query.byState({ state: "open" }).go();
		expect(open.data.filter((i) => i.linkId === link.id)).toHaveLength(1);
	});

	it("AC-05: one failure then OK → no incident", async () => {
		const link = await createLink(t.db, { url: `${base}/503?ac05` }, { now });
		await checkAt(link.domain, link.id, at("2026-09-29T23:02:00.000Z"));
		await t.db.Link.patch({ domain: link.domain, id: link.id })
			.set({ url: `${base}/200?ac05` })
			.go();
		await checkAt(link.domain, link.id, at("2026-09-29T23:04:00.000Z"));
		expect(await incidents(link.id)).toEqual([]);
		const { data } = await t.db.Link.get({
			domain: link.domain,
			id: link.id,
		}).go();
		expect(data?.status).toBe("up");
	});

	it("AC-07: open incident, link back to 200 → incident closed with the downtime", async () => {
		const link = await createLink(t.db, { url: `${base}/404?ac07` }, { now });
		await checkAt(link.domain, link.id, at("2026-09-29T23:02:00.000Z"));
		await checkAt(link.domain, link.id, at("2026-09-29T23:04:00.000Z"));
		await t.db.Link.patch({ domain: link.domain, id: link.id })
			.set({ url: `${base}/200?ac07` })
			.go();
		await checkAt(link.domain, link.id, at("2026-09-29T23:34:00.000Z"));
		const [inc] = await incidents(link.id);
		expect(inc).toMatchObject({
			state: "closed",
			closedAt: "2026-09-29T23:34:00.000Z",
			closedReason: "recovered",
			downtimeMs: 30 * 60_000,
		});
		const stat = await t.db.DayStat.get({
			linkId: link.id,
			day: "2026-09-30",
		}).go();
		expect(stat.data).toMatchObject({ checks: 3, dead: 2, up: 1 });
	});
});

describe("Checker handler — delayed rechecks (step 14, PLAN Q2)", () => {
	const sqsMock = mockClient(SQSClient);
	const QUEUE = "https://sqs.local/linkwatch-priority";
	const withQueue = (when: Date) =>
		createHandler({
			db: t.db,
			now: () => when,
			probeOptions: { allowPrivate: true },
			priorityQueue: { sqs: new SQSClient({}), queueUrl: QUEUE },
		});
	const sent = () =>
		sqsMock.commandCalls(SendMessageCommand).map((c) => ({
			delay: c.args[0].input.DelaySeconds,
			queue: c.args[0].input.QueueUrl,
			body: JSON.parse(c.args[0].input.MessageBody ?? "{}"),
		}));

	it("5.2 step 1: first failure → recheck job on the priority queue after 120 seconds", async () => {
		sqsMock.reset();
		sqsMock.on(SendMessageCommand).resolves({ MessageId: "x" });
		const link = await createLink(t.db, { url: `${base}/404?q1` }, { now });
		await withQueue(now)(event(record(job(link.domain, [link.id]))));
		expect(sent()).toEqual([
			{
				delay: 120,
				queue: QUEUE,
				body: {
					kind: "recheck",
					domain: link.domain,
					linkIds: [link.id],
					dueAt: "2026-09-29T23:04:00.000Z",
				},
			},
		]);
		// next_run_at is only a Dispatcher fallback, 5 minutes after the recheck.
		const { data } = await t.db.Link.get({
			domain: link.domain,
			id: link.id,
		}).go();
		expect(data?.nextRunAt).toBe("2026-09-29T23:09:00.000Z");
	});

	it("5.2 step 3: the recheck opens the incident and queues the next one after 600 seconds", async () => {
		sqsMock.reset();
		sqsMock.on(SendMessageCommand).resolves({ MessageId: "x" });
		const link = await createLink(t.db, { url: `${base}/404?q3` }, { now });
		await withQueue(now)(event(record(job(link.domain, [link.id]))));
		const recheck = sent()[0]?.body;
		const later = new Date("2026-09-29T23:04:00.000Z");
		await withQueue(later)(
			event({
				...record(recheck),
				eventSourceARN: "arn:aws:sqs:ap-southeast-1:1:linkwatch-priority",
			}),
		);
		expect(
			(await t.db.Incident.query.primary({ linkId: link.id }).go()).data,
		).toHaveLength(1);
		expect(sent().map((s) => s.delay)).toEqual([120, 600]);
	});

	it("FR-17: a healthy link on the default schedule queues nothing", async () => {
		sqsMock.reset();
		const link = await createLink(t.db, { url: `${base}/200?q0` }, { now });
		await withQueue(now)(event(record(job(link.domain, [link.id]))));
		expect(sent()).toEqual([]);
	});

	it("NFR-04: SQS failing to queue the recheck does not fail the message (Dispatcher fallback)", async () => {
		sqsMock.reset();
		sqsMock.on(SendMessageCommand).rejects(new Error("throttled"));
		const link = await createLink(t.db, { url: `${base}/404?qf` }, { now });
		const res = await withQueue(now)(
			event(record(job(link.domain, [link.id]))),
		);
		expect(res.batchItemFailures).toEqual([]);
		const { data } = await t.db.Link.get({
			domain: link.domain,
			id: link.id,
		}).go();
		expect(data).toMatchObject({
			status: "suspect",
			nextRunAt: "2026-09-29T23:09:00.000Z",
		});
	});

	it("NFR-04: on the priority Standard queue only the failed message is returned", async () => {
		const arn = "arn:aws:sqs:ap-southeast-1:1:linkwatch-priority";
		const a = await createLink(t.db, { url: `${base}/200?std` }, { now });
		const res = await handler()(
			event(
				{ ...record("{bad", "p1"), eventSourceARN: arn },
				{
					...record(
						{
							kind: "recheck",
							domain: a.domain,
							linkIds: [a.id],
							dueAt: now.toISOString(),
						},
						"p2",
					),
					eventSourceARN: arn,
				},
			),
		);
		expect(res.batchItemFailures).toEqual([{ itemIdentifier: "p1" }]);
		expect(
			(await t.db.Check.query.byLink({ linkId: a.id }).go()).data,
		).toHaveLength(1);
	});
});
