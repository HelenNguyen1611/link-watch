import { parseCsv, toCsv } from "@linkwatch/core";

/** Rows per POST /api/links/import call (the API refuses more). */
export const IMPORT_CHUNK = 25;

/**
 * FR-03: splits an import into texts of ≤ 25 data rows the API can commit one by one.
 * A CSV keeps its header row in every chunk; a plain list stays one URL per line.
 */
export function importChunks(text: string, size = IMPORT_CHUNK): string[] {
	const rows = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
	if (rows.length === 0) return [];
	const header = rows[0] ?? [];
	const isCsv = header.map((h) => h.trim().toLowerCase()).includes("url");
	const body = isCsv ? rows.slice(1) : rows;
	const chunks: string[] = [];
	for (let i = 0; i < body.length; i += size) {
		const part = body.slice(i, i + size);
		chunks.push(
			isCsv ? toCsv([header, ...part]) : part.map((r) => r[0] ?? "").join("\n"),
		);
	}
	return chunks;
}
