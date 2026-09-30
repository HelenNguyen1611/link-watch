/**
 * Minimal RFC 4180 CSV: comma separator, double quotes around fields containing a comma,
 * quote or line break, "" for a quote inside a field, CRLF or LF line endings.
 */
export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let quoted = false;
	let i = 0;
	const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // strip BOM (Excel)
	while (i < src.length) {
		const ch = src[i];
		if (quoted) {
			if (ch === '"') {
				if (src[i + 1] === '"') {
					field += '"';
					i += 2;
					continue;
				}
				quoted = false;
			} else field += ch;
			i++;
			continue;
		}
		if (ch === '"' && field === "") quoted = true;
		else if (ch === ",") {
			row.push(field);
			field = "";
		} else if (ch === "\n" || ch === "\r") {
			row.push(field);
			rows.push(row);
			row = [];
			field = "";
			if (ch === "\r" && src[i + 1] === "\n") i++;
		} else field += ch;
		i++;
	}
	if (field !== "" || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	return rows;
}

const needsQuotes = /[",\r\n]/;
/** Formula-injection guard: a cell starting with = + - @ is prefixed with ' (spreadsheet apps). */
const formula = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
	if (value === undefined || value === null) return "";
	let s = String(value);
	if (formula.test(s)) s = `'${s}`;
	return needsQuotes.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCsv(rows: readonly (readonly unknown[])[]): string {
	return `${rows.map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
