import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../db/testing";
import { ImportTooLargeError, parseCsv } from "../index";
import { commitImport, previewImport } from "./import";
import {
	createLink,
	DuplicateLinkError,
	deleteLinks,
	getLink,
	LinkNotFoundError,
	linksToCsv,
	setPaused,
	updateLink,
	urlHash,
} from "./links";

let t: TestDb;
beforeAll(async () => {
	t = await createTestDb();
});
afterAll(() => t?.drop());

const NOW = new Date("2026-09-30T03:00:00.000Z");

describe("updateLink — FR-04", () => {
	it("FR-04: edits only the fields sent; clearing a name removes it", async () => {
		const l = await createLink(
			t.db,
			{ url: "https://edit.vn/a", name: "A", keyword: "Buy" },
			{ now: NOW },
		);
		const edited = await updateLink(t.db, l.id, {
			name: "",
			timeoutS: 10,
			tags: ["x", "x", "y"],
		});
		expect(edited).toMatchObject({
			url: "https://edit.vn/a",
			timeoutS: 10,
			tags: ["x", "y"],
			keyword: "Buy",
		});
		expect(edited.name).toBeUndefined();
	});

	it("FR-02 / FR-04: a new URL on the same domain moves the URL lock and resets to Pending", async () => {
		const l = await createLink(
			t.db,
			{ url: "https://edit.vn/b" },
			{ now: NOW },
		);
		await t.db.Link.patch({ domain: l.domain, id: l.id })
			.set({
				status: "dead",
				lastHttpCode: 404,
				lastCheckedAt: NOW.toISOString(),
				nextRunAt: "2026-10-01T00:00:00.000Z",
			})
			.go();
		const later = new Date("2026-09-30T04:00:00.000Z");
		const edited = await updateLink(
			t.db,
			l.id,
			{ url: "https://EDIT.vn/b2#x" },
			{ now: later },
		);
		expect(edited).toMatchObject({
			url: "https://edit.vn/b2",
			status: "pending",
			nextRunAt: later.toISOString(),
		});
		expect(edited.lastHttpCode).toBeUndefined();
		expect(
			(await t.db.UrlLock.get({ urlHash: urlHash("https://edit.vn/b") }).go())
				.data,
		).toBeNull();
		expect(
			(await t.db.UrlLock.get({ urlHash: urlHash("https://edit.vn/b2") }).go())
				.data?.linkId,
		).toBe(l.id);
		// The old URL can be added again.
		await createLink(t.db, { url: "https://edit.vn/b" }, { now: NOW });
	});

	it("FR-07: a URL on another root domain moves the link (same id) and creates the domain", async () => {
		const l = await createLink(
			t.db,
			{ url: "https://old.vn/page", name: "Moved" },
			{ now: NOW },
		);
		await t.db.Check.put({
			linkId: l.id,
			checkedAt: NOW.toISOString(),
			result: "up",
			responseMs: 5,
		}).go();
		const edited = await updateLink(
			t.db,
			l.id,
			{ url: "https://www.new-home.vn/page" },
			{ now: NOW },
		);
		expect(edited).toMatchObject({
			id: l.id,
			domain: "new-home.vn",
			name: "Moved",
			status: "pending",
		});
		expect(
			(await t.db.Link.get({ domain: "old.vn", id: l.id }).go()).data,
		).toBeNull();
		expect(
			(await t.db.Domain.get({ name: "new-home.vn" }).go()).data,
		).not.toBeNull();
		expect(
			(await t.db.Check.query.byLink({ linkId: l.id }).go()).data,
		).toHaveLength(1);
	});

	it("FR-02: editing to a URL that is already monitored is refused; unknown id → not found", async () => {
		const a = await createLink(
			t.db,
			{ url: "https://dup-edit.vn/a" },
			{ now: NOW },
		);
		await createLink(t.db, { url: "https://dup-edit.vn/b" }, { now: NOW });
		await expect(
			updateLink(t.db, a.id, { url: "https://dup-edit.vn/b" }),
		).rejects.toBeInstanceOf(DuplicateLinkError);
		await expect(
			updateLink(t.db, "NOPE", { name: "x" }),
		).rejects.toBeInstanceOf(LinkNotFoundError);
		await expect(
			updateLink(t.db, a.id, { bogus: 1 } as never),
		).rejects.toThrow();
	});
});

describe("setPaused / deleteLinks — FR-04", () => {
	it("FR-04: pausing removes next_run_at (the Dispatcher skips it); resuming schedules a check now", async () => {
		const a = await createLink(
			t.db,
			{ url: "https://pause.vn/a" },
			{ now: NOW },
		);
		const b = await createLink(
			t.db,
			{ url: "https://pause.vn/b" },
			{ now: NOW },
		);
		const res = await setPaused(t.db, [a.id, b.id, "NOPE"], true, { now: NOW });
		expect(res).toEqual({ updated: [a.id, b.id], notFound: ["NOPE"] });
		const paused = await getLink(t.db, a.id);
		expect(paused.paused).toBe(true);
		expect(paused.nextRunAt).toBeUndefined();
		const due = await t.db.Link.query
			.due({})
			.lte({ nextRunAt: "2030-01-01T00:00:00.000Z" })
			.go({ pages: "all" });
		expect(due.data.map((l) => l.id)).not.toContain(a.id);

		const later = new Date("2026-09-30T05:00:00.000Z");
		await setPaused(t.db, [a.id], false, { now: later });
		expect(await getLink(t.db, a.id)).toMatchObject({
			paused: false,
			nextRunAt: later.toISOString(),
		});
	});

	it("FR-04: editing the URL of a paused link keeps it paused (no next_run_at)", async () => {
		const p = await createLink(
			t.db,
			{ url: "https://pause.vn/c" },
			{ now: NOW },
		);
		await setPaused(t.db, [p.id], true);
		const edited = await updateLink(t.db, p.id, { url: "https://pause.vn/c2" });
		expect(edited.paused).toBe(true);
		expect(edited.nextRunAt).toBeUndefined();
	});

	it("FR-04: soft-deletes several links at once", async () => {
		const a = await createLink(
			t.db,
			{ url: "https://bulk-del.vn/a" },
			{ now: NOW },
		);
		const b = await createLink(
			t.db,
			{ url: "https://bulk-del.vn/b" },
			{ now: NOW },
		);
		expect(await deleteLinks(t.db, [a.id, b.id, a.id, "NOPE"])).toEqual({
			updated: [a.id, b.id],
			notFound: ["NOPE"],
		});
		await expect(getLink(t.db, a.id)).rejects.toBeInstanceOf(LinkNotFoundError);
		await expect(deleteLinks(t.db, [])).rejects.toThrow();
	});
});

describe("import — FR-03, AC-01", () => {
	it("AC-01: importing a.abc.com/x, b.abc.com/y, xyz.vn creates 2 domains (abc.com with 2 links, xyz.vn with 1)", async () => {
		const text =
			"url\nhttps://a.abc.com/x\nhttps://b.abc.com/y\nhttps://xyz.vn\n";
		const preview = await previewImport(t.db, text);
		expect(preview.summary).toEqual({ valid: 3, duplicate: 0, error: 0 });
		const res = await commitImport(t.db, text, { now: NOW });
		expect(res.created).toHaveLength(3);
		const abc = await t.db.Link.query.primary({ domain: "abc.com" }).go();
		const xyz = await t.db.Link.query.primary({ domain: "xyz.vn" }).go();
		expect(abc.data).toHaveLength(2);
		expect(xyz.data).toHaveLength(1);
		expect(
			(await t.db.Domain.get({ name: "abc.com" }).go()).data,
		).not.toBeNull();
	});

	it("FR-03: preview flags links already monitored; commit skips them and errors", async () => {
		const text = "https://xyz.vn/\nnot a url\nhttps://fresh.vn/1\n";
		const preview = await previewImport(t.db, text);
		expect(preview.rows.map((r) => [r.status, r.error])).toEqual([
			["duplicate", "duplicate_existing"],
			["error", "invalid_url"],
			["valid", undefined],
		]);
		const res = await commitImport(t.db, text, { now: NOW });
		expect(res.created.map((c) => c.url)).toEqual(["https://fresh.vn/1"]);
		expect(res.rejected).toHaveLength(2);
	});

	it("FR-03: a commit call takes at most 25 rows (the web sends chunks)", async () => {
		const text = Array.from(
			{ length: 26 },
			(_, i) => `https://chunk.vn/${i}`,
		).join("\n");
		await expect(commitImport(t.db, text)).rejects.toBeInstanceOf(
			ImportTooLargeError,
		);
	});
});

describe("linksToCsv — FR-05", () => {
	it("FR-05: exports links with their status in the import column format", async () => {
		const l = await getLink(
			t.db,
			(
				await createLink(
					t.db,
					{
						url: "https://export.vn/a",
						name: "Home",
						tags: ["x", "y"],
						expectedCodes: [
							{ from: 200, to: 299 },
							{ from: 404, to: 404 },
						],
					},
					{ now: NOW },
				)
			).id,
		);
		const rows = parseCsv(linksToCsv([l]));
		expect(rows[0]?.slice(0, 9)).toEqual([
			"url",
			"name",
			"domain",
			"tags",
			"method",
			"expected_codes",
			"timeout_s",
			"keyword",
			"status",
		]);
		expect(rows[1]?.slice(0, 10)).toEqual([
			"https://export.vn/a",
			"Home",
			"export.vn",
			"x;y",
			"GET",
			"200-299;404",
			"30",
			"",
			"pending",
			"no",
		]);
	});
});
