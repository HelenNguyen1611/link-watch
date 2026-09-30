import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../db/testing";
import { createLink, deleteLink } from "./links";
import {
	readLinkSnapshot,
	refreshLinkSnapshot,
	type SnapshotStore,
} from "./snapshot";

let t: TestDb;
beforeAll(async () => {
	t = await createTestDb();
});
afterAll(() => t?.drop());

const memoryStore = () => {
	let body: string | null = null;
	const store: SnapshotStore = {
		read: async () => body,
		write: async (b) => {
			body = b;
		},
	};
	return store;
};
const NOW = new Date("2026-09-30T03:00:00.000Z");

describe("link snapshot — step 19b", () => {
	it("step 19b: the Dispatcher stores every non-deleted link as a list row; the API reads it back", async () => {
		const a = await createLink(
			t.db,
			{ url: "https://snap.vn/a" },
			{ now: NOW },
		);
		const b = await createLink(
			t.db,
			{ url: "https://snap.vn/b" },
			{ now: NOW },
		);
		await deleteLink(t.db, b.id, { now: NOW });
		const store = memoryStore();
		expect(await refreshLinkSnapshot(t.db, store, NOW)).toBe(1);
		const snap = await readLinkSnapshot(t.db, store);
		expect(snap).toMatchObject({
			generatedAt: NOW.toISOString(),
			stored: true,
		});
		expect(snap.items.map((l) => l.id)).toEqual([a.id]);
		expect(snap.items[0]).not.toHaveProperty("deletedAt");
		expect(snap.items[0]).not.toHaveProperty("lastJobId");
	});

	it("step 19b: no stored snapshot yet (first deploy, local API) → built on the fly", async () => {
		const snap = await readLinkSnapshot(t.db, memoryStore(), NOW);
		expect(snap.stored).toBe(false);
		expect(snap.items.length).toBeGreaterThan(0);
		expect((await readLinkSnapshot(t.db, undefined, NOW)).stored).toBe(false);
	});
});
