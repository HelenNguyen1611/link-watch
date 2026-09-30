import type { Db } from "../db/index";
import { type ImportRow, ImportTooLargeError, parseImport } from "../import";
import { createLink, DuplicateLinkError, urlHash } from "./links";

export type ImportPreview = {
	rows: ImportRow[];
	summary: { valid: number; duplicate: number; error: number };
};

const summarize = (rows: readonly ImportRow[]) => ({
	valid: rows.filter((r) => r.status === "valid").length,
	duplicate: rows.filter((r) => r.status === "duplicate").length,
	error: rows.filter((r) => r.status === "error").length,
});

/** FR-03: preview — valid / duplicate (in the file or already monitored) / error per row. */
export async function previewImport(
	db: Db,
	text: string,
): Promise<ImportPreview> {
	const rows = parseImport(text);
	const valid = rows.filter((r) => r.status === "valid");
	if (valid.length > 0) {
		const { data } = await db.UrlLock.get(
			valid.map((r) => ({ urlHash: urlHash(r.url) })),
		).go();
		const existing = new Set(data.map((l) => l.url));
		for (const r of valid)
			if (existing.has(r.url)) {
				r.status = "duplicate";
				r.error = "duplicate_existing";
				delete r.input;
			}
	}
	return { rows, summary: summarize(rows) };
}

/** FR-03: at most this many rows per commit call — the web sends a big import in chunks. */
export const IMPORT_CHUNK = 25;

export type ImportCommitResult = {
	created: { line: number; id: string; url: string }[];
	/** Rows not created: errors, duplicates, and URLs added by someone else meanwhile. */
	rejected: ImportRow[];
};

/**
 * FR-03 / FR-07 / AC-01: creates the valid rows of `text` (≤ 25 rows, see IMPORT_CHUNK);
 * domains are created from the root domain of each URL.
 */
export async function commitImport(
	db: Db,
	text: string,
	{ now = new Date() }: { now?: Date } = {},
): Promise<ImportCommitResult> {
	const { rows } = await previewImport(db, text);
	if (rows.length > IMPORT_CHUNK) throw new ImportTooLargeError(rows.length);
	const result: ImportCommitResult = { created: [], rejected: [] };
	for (const row of rows) {
		if (row.status !== "valid" || !row.input) {
			result.rejected.push(row);
			continue;
		}
		try {
			const link = await createLink(db, row.input, { now });
			result.created.push({ line: row.line, id: link.id, url: link.url });
		} catch (err) {
			if (!(err instanceof DuplicateLinkError)) throw err;
			result.rejected.push({
				...row,
				status: "duplicate",
				error: "duplicate_existing",
			});
		}
	}
	return result;
}
