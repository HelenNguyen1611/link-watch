import http from "node:http";
import type { AddressInfo } from "node:net";
import type { ProbeResult } from "@linkwatch/core";
import { checkTtl } from "@linkwatch/core/db";
import { createTestDb, type TestDb } from "@linkwatch/core/db/testing";
import { createLink, deleteLink } from "@linkwatch/core/usecases";
import type { SQSEvent, SQSRecord } from "aws-lambda";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHandler } from "./handler";

let t: TestDb;
let server: http.Server;
let base: string;

beforeAll(async () => {
	t = await createTestDb();
	server = http.createServer((req, res) => {
		const code = Number(req.url?.slice(1)) || 200;
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
	it("FR-17: link 404 → dead link, writes 1 check record with ttl, updates the latest check", async () => {
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
			status: "dead",
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
			status: "dead",
			lastErrorType: "blocked_private_address",
		});
	});
});

describe("Checker handler — retry", () => {
	it("NFR-04: SQS redelivering the same message (same timestamp) does not fail it", async () => {
		const link = await createLink(t.db, { url: `${base}/200?retry` }, { now });
		const h = handler();
		expect(
			(await h(event(record(job(link.domain, [link.id]))))).batchItemFailures,
		).toEqual([]);
		expect(
			(await h(event(record(job(link.domain, [link.id]))))).batchItemFailures,
		).toEqual([]);
		expect(
			(await t.db.Check.query.byLink({ linkId: link.id }).go()).data,
		).toHaveLength(1);
	});
});
