import { TZ_OFFSET_MS } from "@linkwatch/core";

const pad = (n: number) => String(n).padStart(2, "0");

/** dd/MM/yyyy HH:mm in Asia/Saigon time (+07:00, no daylight saving). */
export function formatDateTime(iso: string | undefined): string {
	if (!iso) return "—";
	const d = new Date(Date.parse(iso) + TZ_OFFSET_MS);
	return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

const numberFormat = new Intl.NumberFormat("en-US");
export const formatMs = (ms: number | undefined) =>
	ms === undefined ? "—" : `${numberFormat.format(ms)} ms`;

/** HH:mm:ss in Asia/Saigon time, e.g. when the list was last refreshed. */
export function formatClock(epochMs: number): string {
	const d = new Date(epochMs + TZ_OFFSET_MS);
	return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** FR-19: incident duration, e.g. "45 min", "2 h 5 min", "3 d 4 h". */
export function formatDuration(ms: number | undefined): string {
	if (ms === undefined) return "—";
	const minutes = Math.max(0, Math.round(ms / 60_000));
	if (minutes < 1) return "< 1 min";
	const d = Math.floor(minutes / 1440);
	const h = Math.floor((minutes % 1440) / 60);
	const m = minutes % 60;
	if (d > 0) return h > 0 ? `${d} d ${h} h` : `${d} d`;
	if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
	return `${m} min`;
}
