import type { IncidentView } from "@linkwatch/core";

/** FR-19: closed → stored downtime; still open → time since it was opened. */
export const incidentDurationMs = (i: IncidentView, now: Date) =>
	i.state === "closed"
		? i.downtimeMs
		: Math.max(0, now.getTime() - Date.parse(i.openedAt));

/** Link to the incident page (static export → query string). */
export const incidentHref = (id: string) =>
	`/incidents/?id=${encodeURIComponent(id)}`;

/** Link to the link detail page (step 28). */
export const linkHref = (linkId: string) =>
	`/links/detail/?id=${encodeURIComponent(linkId)}`;
