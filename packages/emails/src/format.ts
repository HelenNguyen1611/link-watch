import { TZ_OFFSET_MS } from "@linkwatch/core";

/**
 * FR-24: times are shown in Asia/Saigon with the fixed +07:00 offset (no DST), e.g.
 * "2026-09-30 06:04 (GMT+7)" — numeric so it does not depend on the runtime's ICU data.
 */
export const formatTime = (iso: string) => {
	const local = new Date(Date.parse(iso) + TZ_OFFSET_MS).toISOString();
	return `${local.slice(0, 10)} ${local.slice(11, 16)} (GMT+7)`;
};

/** FR-21: downtime, e.g. "45 min", "2 h 5 min", "3 d 4 h". */
export function formatDuration(ms: number): string {
	const minutes = Math.max(0, Math.round(ms / 60_000));
	if (minutes < 1) return "< 1 min";
	const d = Math.floor(minutes / 1440);
	const h = Math.floor((minutes % 1440) / 60);
	const m = minutes % 60;
	if (d > 0) return h > 0 ? `${d} d ${h} h` : `${d} d`;
	if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
	return `${m} min`;
}

/** Link to the incident page of the web app (static export → query string). */
export const incidentUrl = (appUrl: string, incidentId: string) =>
	`${appUrl.replace(/\/+$/, "")}/incidents/?id=${encodeURIComponent(incidentId)}`;

/** FR-33 / FR-35: confirmation page of a token (GET only shows it; the button there does the POST). */
export const confirmUrl = (appUrl: string, token: string) =>
	`${appUrl.replace(/\/+$/, "")}/confirm/?token=${encodeURIComponent(token)}`;
