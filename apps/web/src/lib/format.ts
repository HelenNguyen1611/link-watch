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
