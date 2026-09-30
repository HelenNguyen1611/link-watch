import { parseCsv } from "./csv";
import { type LinkInput, LinkInput as LinkInputSchema } from "./schema/link";

/** FR-03: at most 1,000 rows per import. */
export const MAX_IMPORT_ROWS = 1000;

/** CSV columns (header row, any order, case-insensitive). Only `url` is required. */
export const IMPORT_COLUMNS = [
	"url",
	"name",
	"tags",
	"method",
	"expected_codes",
	"timeout_s",
	"keyword",
] as const;

export type ImportRowError =
	| "invalid_url"
	| "invalid_field"
	| "duplicate_in_file"
	| "duplicate_existing";

export type ImportRow = {
	/** 1-based line number in the pasted text / file (header counts as line 1). */
	line: number;
	url: string;
	status: "valid" | "duplicate" | "error";
	error?: ImportRowError;
	/** Field that failed validation (for `invalid_field`). */
	field?: string;
	input?: LinkInput;
};

export class ImportTooLargeError extends Error {
	readonly code = "import_too_large";
	constructor(readonly rows: number) {
		super(`Too many rows: ${rows} (max ${MAX_IMPORT_ROWS})`);
		this.name = "ImportTooLargeError";
	}
}

/** "200-399;404" → [{from:200,to:399},{from:404,to:404}] */
function parseCodes(value: string) {
	return value
		.split(/[;|\s]+/)
		.filter(Boolean)
		.map((part) => {
			const [from, to] = part.split("-").map((n) => Number(n.trim()));
			return { from: from as number, to: (to ?? from) as number };
		});
}

function rawFromColumns(cells: Record<string, string>) {
	const raw: Record<string, unknown> = { url: cells.url ?? "" };
	if (cells.name) raw.name = cells.name;
	if (cells.tags) raw.tags = cells.tags.split(/[;|]/).map((t) => t.trim());
	if (cells.method) raw.method = cells.method.trim().toUpperCase();
	if (cells.expected_codes)
		raw.expectedCodes = parseCodes(cells.expected_codes);
	if (cells.timeout_s) raw.timeoutS = Number(cells.timeout_s);
	if (cells.keyword) raw.keyword = cells.keyword;
	return raw;
}

/**
 * FR-03: parses a CSV with a header row containing `url`, or a plain list (one URL per line),
 * validates every row with the shared `LinkInput` schema and flags duplicates inside the file.
 * Duplicates of existing links are marked by the caller (it needs the database).
 */
export function parseImport(text: string): ImportRow[] {
	const rows = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
	if (rows.length === 0) return [];
	const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
	const isCsv = header.includes("url");
	const body = isCsv ? rows.slice(1) : rows;
	if (body.length > MAX_IMPORT_ROWS) throw new ImportTooLargeError(body.length);

	const seen = new Set<string>();
	// Line numbers follow the non-empty rows; good enough to point at a row in the preview.
	return body.map((cells, i) => {
		const line = i + (isCsv ? 2 : 1);
		const raw = isCsv
			? rawFromColumns(
					Object.fromEntries(header.map((h, j) => [h, cells[j]?.trim() ?? ""])),
				)
			: { url: (cells[0] ?? "").trim() };
		const parsed = LinkInputSchema.safeParse(raw);
		if (!parsed.success) {
			const issue = parsed.error.issues[0];
			const field = String(issue?.path[0] ?? "url");
			return {
				line,
				url: String(raw.url),
				status: "error" as const,
				error:
					field === "url"
						? ("invalid_url" as const)
						: ("invalid_field" as const),
				...(field !== "url" && { field }),
			};
		}
		const url = parsed.data.url;
		if (seen.has(url))
			return {
				line,
				url,
				status: "duplicate" as const,
				error: "duplicate_in_file" as const,
			};
		seen.add(url);
		return { line, url, status: "valid" as const, input: parsed.data };
	});
}
