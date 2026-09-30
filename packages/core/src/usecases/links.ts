import { createHash } from "node:crypto";
import { toCsv } from "../csv";
import type { Db } from "../db/index";
import { rootDomainOf } from "../domain";
import { newId } from "../id";
import {
	LinkIds,
	LinkInput,
	type LinkInputRaw,
	LinkUpdate,
	type LinkUpdateRaw,
} from "../schema/link";

export class DuplicateLinkError extends Error {
	readonly code = "duplicate";
	constructor(
		readonly url: string,
		readonly existingId?: string,
	) {
		super(`Link already exists: ${url}`);
		this.name = "DuplicateLinkError";
	}
}

export class LinkNotFoundError extends Error {
	readonly code = "not_found";
	constructor(readonly id: string) {
		super(`Link not found: ${id}`);
		this.name = "LinkNotFoundError";
	}
}

type Clock = { now?: Date };

export const urlHash = (url: string) =>
	createHash("sha256").update(url).digest("hex");

const isConditionalFailure = (err: unknown) =>
	/ConditionalCheckFailed|conditional request failed/i.test(
		`${String(err)} ${String((err as { cause?: unknown })?.cause)}`,
	);

/** FR-07: creates the domain if missing; an existing domain is left untouched. */
async function ensureDomain(db: Db, name: string): Promise<void> {
	try {
		await db.Domain.create({ name }).go();
	} catch (err) {
		if (!isConditionalFailure(err)) throw err;
	}
}

/**
 * FR-01, FR-02, FR-07: adds a link.
 * Normalize → resolve root domain → reject duplicates (transaction with the URL lock) → first check on the next tick.
 */
export async function createLink(
	db: Db,
	raw: LinkInputRaw,
	{ now = new Date() }: Clock = {},
) {
	const input = LinkInput.parse(raw);
	const domain = rootDomainOf(input.url);
	const id = newId(now);
	const hash = urlHash(input.url);

	const existing = await db.UrlLock.get({ urlHash: hash }).go();
	if (existing.data)
		throw new DuplicateLinkError(input.url, existing.data.linkId);

	await ensureDomain(db, domain);
	const link = {
		...input,
		id,
		domain,
		status: "pending" as const,
		paused: false,
		nextRunAt: now.toISOString(),
		createdAt: now.toISOString(),
		updatedAt: now.toISOString(),
	};
	const tx = await db.service.transaction
		.write(({ UrlLock, Link }) => [
			UrlLock.create({
				urlHash: hash,
				url: input.url,
				linkId: id,
				domain,
			}).commit(),
			Link.create(link).commit(),
		])
		.go();
	if (tx.canceled) throw new DuplicateLinkError(input.url);
	return link;
}

/**
 * Lists non-deleted links (GSI3), page by page, newest first: ids are ULIDs
 * (time prefix), so descending id order is descending creation order.
 */
export async function listLinks(
	db: Db,
	{ limit = 50, cursor }: { limit?: number; cursor?: string | null } = {},
) {
	const page = await db.Link.query
		.byId({})
		.where(({ deletedAt }, { notExists }) => notExists(deletedAt))
		.go({ limit, cursor: cursor ?? null, order: "desc" });
	return { items: page.data, cursor: page.cursor };
}

/** Finds a non-deleted link by id. */
export async function getLink(db: Db, id: string) {
	const { data } = await db.Link.query.byId({ id }).go();
	const link = data[0];
	if (!link || link.deletedAt) throw new LinkNotFoundError(id);
	return link;
}

/** FR-04: soft delete — sets deletedAt, drops next_run_at (leaves GSI1), removes the URL lock so it can be re-added. */
export async function deleteLink(
	db: Db,
	id: string,
	{ now = new Date() }: Clock = {},
) {
	const link = await getLink(db, id);
	const tx = await db.service.transaction
		.write(({ Link, UrlLock }) => [
			Link.patch({ domain: link.domain, id })
				.set({ deletedAt: now.toISOString() })
				.remove(["nextRunAt"])
				.where(({ deletedAt }, { notExists }) => notExists(deletedAt))
				.commit(),
			UrlLock.delete({ urlHash: urlHash(link.url) }).commit(),
		])
		.go();
	if (tx.canceled) throw new LinkNotFoundError(id);
}

/** Fields cleared when the URL changes: the last result belongs to the old URL. */
const LAST_RESULT = [
	"lastCheckedAt",
	"lastHttpCode",
	"lastResponseMs",
	"lastErrorType",
	"lastJobId",
] as const;

/**
 * FR-04: edits a link (only the fields sent). A new URL is checked for duplicates, resets
 * the status to Pending and is checked on the next tick. A URL on another root domain moves
 * the item to that domain's partition (same id, so checks and incidents stay attached).
 */
export async function updateLink(
	db: Db,
	id: string,
	raw: LinkUpdateRaw,
	{ now = new Date() }: Clock = {},
) {
	const input = LinkUpdate.parse(raw);
	const link = await getLink(db, id);
	const { url, name, keyword, ...rest } = input;
	const cleared = [
		...(name === null ? (["name"] as const) : []),
		...(keyword === null ? (["keyword"] as const) : []),
	];
	const set = {
		...rest,
		...(name ? { name } : {}),
		...(keyword ? { keyword } : {}),
	};

	if (!url || url === link.url) {
		let patch = db.Link.patch({ domain: link.domain, id }).set(set);
		if (cleared.length) patch = patch.remove(cleared) as typeof patch;
		await patch
			.where(({ deletedAt }, { notExists }) => notExists(deletedAt))
			.go()
			.catch((err) => {
				if (isConditionalFailure(err)) throw new LinkNotFoundError(id);
				throw err;
			});
		return getLink(db, id);
	}

	const hash = urlHash(url);
	const existing = await db.UrlLock.get({ urlHash: hash }).go();
	if (existing.data) throw new DuplicateLinkError(url, existing.data.linkId);
	const domain = rootDomainOf(url);
	const fresh = {
		status: "pending" as const,
		...(link.paused ? {} : { nextRunAt: now.toISOString() }),
	};

	if (domain === link.domain) {
		const tx = await db.service.transaction
			.write(({ Link, UrlLock }) => [
				UrlLock.delete({ urlHash: urlHash(link.url) }).commit(),
				UrlLock.create({ urlHash: hash, url, linkId: id, domain }).commit(),
				Link.patch({ domain, id })
					.set({ ...set, url, ...fresh })
					.remove([...cleared, ...LAST_RESULT])
					.where(({ deletedAt }, { notExists }) => notExists(deletedAt))
					.commit(),
			])
			.go();
		if (tx.canceled) throw new DuplicateLinkError(url);
		return getLink(db, id);
	}

	await ensureDomain(db, domain);
	const { domain: _old, ...kept } = link;
	const moved = Object.fromEntries(
		Object.entries({ ...kept, ...set, url, ...fresh }).filter(
			([k, v]) =>
				v !== undefined &&
				!(LAST_RESULT as readonly string[]).includes(k) &&
				!(cleared as readonly string[]).includes(k) &&
				!(link.paused && k === "nextRunAt"),
		),
	);
	const tx = await db.service.transaction
		.write(({ Link, UrlLock }) => [
			UrlLock.delete({ urlHash: urlHash(link.url) }).commit(),
			UrlLock.create({ urlHash: hash, url, linkId: id, domain }).commit(),
			Link.delete({ domain: link.domain, id })
				.where(({ deletedAt }, { notExists }) => notExists(deletedAt))
				.commit(),
			Link.create({ ...(moved as typeof link), domain, id }).commit(),
		])
		.go();
	if (tx.canceled) throw new DuplicateLinkError(url);
	return getLink(db, id);
}

export type BulkResult = { updated: string[]; notFound: string[] };

/**
 * FR-04: pause or resume links. Paused links have no next_run_at (not checked, no alerts);
 * resumed links are checked on the next tick.
 */
export async function setPaused(
	db: Db,
	rawIds: unknown,
	paused: boolean,
	{ now = new Date() }: Clock = {},
): Promise<BulkResult> {
	const ids = [...new Set(LinkIds.parse(rawIds))];
	const result: BulkResult = { updated: [], notFound: [] };
	for (const id of ids) {
		try {
			const link = await getLink(db, id);
			const patch = db.Link.patch({ domain: link.domain, id });
			const op = paused
				? patch.set({ paused: true }).remove(["nextRunAt"])
				: patch.set({ paused: false, nextRunAt: now.toISOString() });
			await op
				.where(({ deletedAt }, { notExists }) => notExists(deletedAt))
				.go();
			result.updated.push(id);
		} catch (err) {
			if (err instanceof LinkNotFoundError || isConditionalFailure(err))
				result.notFound.push(id);
			else throw err;
		}
	}
	return result;
}

/** FR-04: soft-deletes several links; unknown or already deleted ids are reported. */
export async function deleteLinks(
	db: Db,
	rawIds: unknown,
	{ now = new Date() }: Clock = {},
): Promise<BulkResult> {
	const ids = [...new Set(LinkIds.parse(rawIds))];
	const result: BulkResult = { updated: [], notFound: [] };
	for (const id of ids) {
		try {
			await deleteLink(db, id, { now });
			result.updated.push(id);
		} catch (err) {
			if (err instanceof LinkNotFoundError) result.notFound.push(id);
			else throw err;
		}
	}
	return result;
}

/** FR-05: CSV export columns (same names as the import, plus the current state). */
export const EXPORT_COLUMNS = [
	"url",
	"name",
	"domain",
	"tags",
	"method",
	"expected_codes",
	"timeout_s",
	"keyword",
	"status",
	"paused",
	"last_checked_at",
	"last_http_code",
	"last_response_ms",
	"last_error_type",
	"created_at",
] as const;

type ExportableLink = {
	url: string;
	name?: string;
	domain: string;
	tags?: string[];
	method: string;
	expectedCodes: { from: number; to: number }[];
	timeoutS: number;
	keyword?: string;
	status?: string;
	paused?: boolean;
	lastCheckedAt?: string;
	lastHttpCode?: number;
	lastResponseMs?: number;
	lastErrorType?: string;
	createdAt?: string;
};

/** FR-05: links and their current status as CSV (re-importable: same column names). */
export function linksToCsv(links: readonly ExportableLink[]): string {
	return toCsv([
		[...EXPORT_COLUMNS],
		...links.map((l) => [
			l.url,
			l.name,
			l.domain,
			(l.tags ?? []).join(";"),
			l.method,
			l.expectedCodes
				.map((r) => (r.from === r.to ? `${r.from}` : `${r.from}-${r.to}`))
				.join(";"),
			l.timeoutS,
			l.keyword,
			l.status,
			l.paused ? "yes" : "no",
			l.lastCheckedAt,
			l.lastHttpCode,
			l.lastResponseMs,
			l.lastErrorType,
			l.createdAt,
		]),
	]);
}
