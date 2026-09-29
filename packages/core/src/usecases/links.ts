import { createHash } from "node:crypto";
import type { Db } from "../db/index";
import { rootDomainOf } from "../domain";
import { newId } from "../id";
import { LinkInput, type LinkInputRaw } from "../schema/link";

export class DuplicateLinkError extends Error {
	readonly code = "duplicate";
	constructor(
		readonly url: string,
		readonly existingId?: string,
	) {
		super(`Link đã tồn tại: ${url}`);
		this.name = "DuplicateLinkError";
	}
}

export class LinkNotFoundError extends Error {
	readonly code = "not_found";
	constructor(readonly id: string) {
		super(`Không tìm thấy link ${id}`);
		this.name = "LinkNotFoundError";
	}
}

type Clock = { now?: Date };

const urlHash = (url: string) => createHash("sha256").update(url).digest("hex");

const isConditionalFailure = (err: unknown) =>
	/ConditionalCheckFailed|conditional request failed/i.test(
		`${String(err)} ${String((err as { cause?: unknown })?.cause)}`,
	);

/** FR-07: tạo domain nếu chưa có; domain đã có thì giữ nguyên. */
async function ensureDomain(db: Db, name: string): Promise<void> {
	try {
		await db.Domain.create({ name }).go();
	} catch (err) {
		if (!isConditionalFailure(err)) throw err;
	}
}

/**
 * FR-01, FR-02, FR-07: thêm một link.
 * Chuẩn hóa → xác định domain chính → chặn trùng (transaction với khóa URL) → lượt check đầu ở tick kế tiếp.
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

/** Liệt kê link chưa xóa (GSI3), theo trang. */
export async function listLinks(
	db: Db,
	{ limit = 50, cursor }: { limit?: number; cursor?: string | null } = {},
) {
	const page = await db.Link.query
		.byId({})
		.where(({ deletedAt }, { notExists }) => notExists(deletedAt))
		.go({ limit, cursor: cursor ?? null });
	return { items: page.data, cursor: page.cursor };
}

/** Tìm link chưa xóa theo id. */
export async function getLink(db: Db, id: string) {
	const { data } = await db.Link.query.byId({ id }).go();
	const link = data[0];
	if (!link || link.deletedAt) throw new LinkNotFoundError(id);
	return link;
}

/** FR-04: xóa mềm — ghi deletedAt, bỏ next_run_at (rời GSI1), gỡ khóa URL để thêm lại được. */
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
