import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../db/testing";
import { recordCheck } from "./checks";
import { getDomainDetail, listDomainSummaries, updateDomain } from "./domains";
import { createLink, getLink, setPaused } from "./links";
import { refreshLinkSnapshot, type SnapshotStore } from "./snapshot";

let t: TestDb;
beforeAll(async () => {
	t = await createTestDb();
});
afterAll(() => t?.drop());

const NOW = new Date("2026-09-30T03:00:00.000Z");
const memory = () => {
	let body: string | null = null;
	const store: SnapshotStore = {
		read: async () => body,
		write: async (b) => {
			body = b;
		},
	};
	return store;
};
let job = 0;
const check = async (
	id: string,
	result: "up" | "dead" | "down",
	ms: number,
	at: Date,
) =>
	recordCheck(
		t.db,
		await getLink(t.db, id),
		{ result, responseMs: ms, httpCode: result === "up" ? 200 : 503 },
		{
			now: at,
			jobId: `j${++job}`,
		},
	);

describe("domain overview — FR-09, FR-10, NFR-02", () => {
	it("FR-10: counts per status, paused, average response, last/next check, uptime 7/30 from domain counters", async () => {
		const a = await createLink(
			t.db,
			{ url: "https://dsum.vn/a" },
			{ now: NOW },
		);
		const b = await createLink(
			t.db,
			{ url: "https://dsum.vn/b" },
			{ now: NOW },
		);
		const c = await createLink(
			t.db,
			{ url: "https://dsum.vn/c" },
			{ now: NOW },
		);
		await check(a.id, "up", 100, NOW);
		await check(b.id, "up", 300, NOW);
		await check(b.id, "down", 50, new Date(NOW.getTime() + 60_000)); // suspect, not a confirmed failure
		await setPaused(t.db, [c.id], true);

		const store = memory();
		await refreshLinkSnapshot(t.db, store, NOW);
		const { items } = await listDomainSummaries(t.db, store, NOW);
		const d = items.find((x) => x.name === "dsum.vn");
		expect(d).toMatchObject({
			total: 3,
			paused: 1,
			counts: { up: 1, suspect: 1 },
			status: "normal",
			avgResponseMs: 75,
			schedule: { source: "default" },
		});
		// 3 checks today: 2 up, 1 down → 66.67 %.
		expect(d?.uptime7).toBeCloseTo(66.67, 2);
		expect(d?.uptime30).toBeCloseTo(66.67, 2);
		expect(d?.lastCheckedAt).toBe(
			new Date(NOW.getTime() + 60_000).toISOString(),
		);
		expect(d?.nextRunAt).toBeDefined();
	});

	it("FR-10: domain detail has live counts and the 30-day uptime bar", async () => {
		const detail = await getDomainDetail(t.db, "dsum.vn", NOW);
		expect(detail.uptimeDays.days).toHaveLength(30);
		expect(detail.uptimeDays.days.at(-1)).toMatchObject({
			day: "2026-09-30",
			checks: 3,
		});
		expect(detail.total).toBe(3);
	});

	it("NFR-02: the uptime cache is reused within the hour, recomputed after", async () => {
		const store = memory();
		await refreshLinkSnapshot(t.db, store, NOW);
		const first = JSON.parse((await store.read()) as string).uptime.generatedAt;
		await refreshLinkSnapshot(
			t.db,
			store,
			new Date(NOW.getTime() + 5 * 60_000),
		);
		expect(JSON.parse((await store.read()) as string).uptime.generatedAt).toBe(
			first,
		);
		await refreshLinkSnapshot(
			t.db,
			store,
			new Date(NOW.getTime() + 61 * 60_000),
		);
		expect(
			JSON.parse((await store.read()) as string).uptime.generatedAt,
		).not.toBe(first);
	});

	it("FR-08: settings shown in the overview (display name, flags)", async () => {
		await updateDomain(t.db, "dsum.vn", {
			displayName: "D Sum",
			ignoreWaf403: true,
		});
		const { items } = await listDomainSummaries(t.db, undefined, NOW);
		expect(items.find((x) => x.name === "dsum.vn")).toMatchObject({
			displayName: "D Sum",
			ignoreWaf403: true,
		});
	});
});
