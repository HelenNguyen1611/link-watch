import { SendMessageBatchCommand, SQSClient } from "@aws-sdk/client-sqs";
import { createHandler as createChecker } from "@linkwatch/checker/handler";
import { type CheckJob, JITTER_MAX_MS } from "@linkwatch/core";
import { createTestDb, type TestDb } from "@linkwatch/core/db/testing";
import { createLink } from "@linkwatch/core/usecases";
import type { SQSEvent } from "aws-lambda";
import { mockClient } from "aws-sdk-client-mock";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHandler, LEASE_MS } from "./handler";

const sqsMock = mockClient(SQSClient);
const QUEUE_URL = "https://sqs.local/123/linkwatch-checks.fifo";
let t: TestDb;

beforeAll(async () => {
	t = await createTestDb();
});
afterAll(() => t?.drop());
beforeEach(() => {
	sqsMock.reset();
	sqsMock.on(SendMessageBatchCommand).callsFake((input) => ({
		Successful: input.Entries.map((e: { Id: string }) => ({
			Id: e.Id,
			MessageId: e.Id,
		})),
		Failed: [],
	}));
});

type Entry = {
	Id: string;
	MessageBody: string;
	MessageGroupId: string;
	MessageDeduplicationId: string;
};
const sentEntries = (): Entry[] =>
	sqsMock
		.commandCalls(SendMessageBatchCommand)
		.flatMap((c) => c.args[0].input.Entries as Entry[]);
const sentJobs = () =>
	sentEntries().map((e) => JSON.parse(e.MessageBody) as CheckJob);

const dispatcher = (now: Date) =>
	createHandler({
		db: t.db,
		sqs: new SQSClient({ region: "local" }),
		queueUrl: QUEUE_URL,
		now: () => now,
	});

const addLinks = async (domain: string, n: number, nextRunAt: string) => {
	const ids: string[] = [];
	for (let i = 0; i < n; i++) {
		const link = await createLink(
			t.db,
			{ url: `https://${domain}/p${i}` },
			{ now: new Date(nextRunAt) },
		);
		ids.push(link.id);
	}
	return ids;
};

describe("Dispatcher", () => {
	const t0 = "2026-09-29T09:00:00.000Z";
	const tick = new Date("2026-09-29T09:05:00.000Z");

	it("FR-14: gom link đến hạn theo domain, tối đa 20 link/message, MessageGroupId = domain", async () => {
		const a = await addLinks("a.com", 45, t0);
		const b = await addLinks("b.vn", 3, t0);
		const res = await dispatcher(tick)();
		expect(res).toMatchObject({ due: 48, dispatched: 48, messages: 4 });

		const jobs = sentJobs();
		const byDomain = (d: string) =>
			jobs
				.filter((j) => j.domain === d)
				.map((j) => j.linkIds.length)
				.sort((x, y) => y - x);
		expect(byDomain("a.com")).toEqual([20, 20, 5]);
		expect(byDomain("b.vn")).toEqual([3]);
		expect(jobs.flatMap((j) => j.linkIds).sort()).toEqual([...a, ...b].sort());
		for (const e of sentEntries()) {
			const job = JSON.parse(e.MessageBody) as CheckJob;
			expect(e.MessageGroupId).toBe(job.domain);
			expect(e.MessageDeduplicationId).toMatch(/^[0-9a-f]{64}$/);
			expect(job).toMatchObject({
				kind: "scheduled",
				dispatchedAt: tick.toISOString(),
			});
		}
	});

	it("SQS: mỗi lệnh SendMessageBatch tối đa 10 message", async () => {
		for (const c of sqsMock.commandCalls(SendMessageBatchCommand)) {
			expect(c.args[0].input.Entries?.length).toBeLessThanOrEqual(10);
		}
	});

	it("không gửi trùng: tick kế tiếp không lấy lại link vừa gửi (đã dời next_run_at)", async () => {
		const res = await dispatcher(new Date("2026-09-29T09:10:00.000Z"))();
		expect(res).toMatchObject({ due: 0, messages: 0 });
		expect(sqsMock.commandCalls(SendMessageBatchCommand)).toHaveLength(0);
	});

	it("NFR-04: Checker không xử lý xong (job vào DLQ) thì hết hạn giữ chỗ 30 phút link được gửi lại", async () => {
		expect(LEASE_MS).toBe(30 * 60_000);
		const later = new Date(tick.getTime() + LEASE_MS);
		const res = await dispatcher(later)();
		expect(res.due).toBe(48);
		expect(
			sentJobs().every((j) => j.dispatchedAt === later.toISOString()),
		).toBe(true);
	});

	it("NFR-04: gửi SQS lỗi thì trả next_run_at về như cũ để tick sau thử lại", async () => {
		const [id] = await addLinks("fail.vn", 1, "2026-09-29T11:00:00.000Z");
		sqsMock.on(SendMessageBatchCommand).callsFake((input) => ({
			Successful: [],
			Failed: input.Entries.map((e: { Id: string }) => ({
				Id: e.Id,
				Code: "InternalError",
				SenderFault: false,
			})),
		}));
		const at = new Date("2026-09-29T11:05:00.000Z");
		const res = await dispatcher(at)();
		expect(res.dispatched).toBe(0);
		expect(res.failed).toBe(res.due);
		const { data } = await t.db.Link.get({ domain: "fail.vn", id }).go();
		expect(data?.nextRunAt).toBe("2026-09-29T11:00:00.000Z");
	});

	it("FR-04: link tạm dừng không được gửi", async () => {
		const [id] = await addLinks("paused.vn", 1, "2026-09-29T12:00:00.000Z");
		await t.db.Link.patch({ domain: "paused.vn", id })
			.set({ paused: true })
			.remove(["nextRunAt"])
			.go();
		await dispatcher(new Date("2026-09-29T12:05:00.000Z"))();
		expect(sentJobs().flatMap((j) => j.linkIds)).not.toContain(id);
	});
});

describe("AC-02 — lịch mặc định 06:00", () => {
	it("AC-02: link không có lịch riêng được check trong khoảng 06:00–06:15 (Dispatcher mỗi 5 phút)", async () => {
		const own = await createTestDb();
		try {
			// Thêm link lúc 17:00 ngày 29/09 giờ VN và cho Checker chạy lượt đầu ngay.
			const created = new Date("2026-09-29T10:00:00.000Z");
			const ids: string[] = [];
			for (let i = 0; i < 30; i++) {
				ids.push(
					(
						await createLink(
							own.db,
							{ url: `https://ac02-${i % 3}.vn/p${i}` },
							{ now: created },
						)
					).id,
				);
			}
			const checks: Record<string, string[]> = {};
			const probe = async () => ({
				httpCode: 200,
				responseMs: 50,
				redirectCount: 0,
			});

			const runTick = async (at: Date) => {
				sqsMock.reset();
				sqsMock.on(SendMessageBatchCommand).callsFake((input) => ({
					Successful: input.Entries.map((e: { Id: string }) => ({
						Id: e.Id,
						MessageId: e.Id,
					})),
					Failed: [],
				}));
				await createHandler({
					db: own.db,
					sqs: new SQSClient({ region: "local" }),
					queueUrl: QUEUE_URL,
					now: () => at,
				})();
				// Checker nhận message trong vòng 1 phút sau tick.
				const checkAt = new Date(at.getTime() + 60_000);
				const records = sentEntries().map((e) => ({
					messageId: e.Id,
					body: e.MessageBody,
				}));
				const checker = createChecker({
					db: own.db,
					now: () => checkAt,
					probe,
				});
				await checker({ Records: records } as SQSEvent);
				for (const r of records) {
					for (const id of (JSON.parse(r.body) as CheckJob).linkIds) {
						checks[id] = [...(checks[id] ?? []), checkAt.toISOString()];
					}
				}
			};

			await runTick(new Date("2026-09-29T10:00:00.000Z")); // lượt đầu khi vừa thêm
			for (const id of ids) checks[id] = [];
			// Mô phỏng Dispatcher mỗi 5 phút từ 05:00 tới 07:00 ngày 30/09 giờ VN.
			for (let m = 0; m <= 120; m += 5)
				await runTick(
					new Date(Date.parse("2026-09-29T22:00:00.000Z") + m * 60_000),
				);

			const from = Date.parse("2026-09-29T23:00:00.000Z");
			const to = Date.parse("2026-09-29T23:15:00.000Z");
			for (const id of ids) {
				expect(checks[id], id).toHaveLength(1);
				const at = Date.parse(checks[id][0]);
				expect(at).toBeGreaterThanOrEqual(from);
				expect(at).toBeLessThanOrEqual(to);
			}
			expect(JITTER_MAX_MS).toBe(5 * 60_000);
		} finally {
			await own.drop();
		}
	});
});
