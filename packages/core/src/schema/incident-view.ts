import { z } from "zod";

import {
	CheckErrorType,
	CheckResultKind,
	IncidentState,
	IncidentType,
} from "./enums";

/** FR-19: incident as returned to the web (type shared by API ↔ web). */
export const IncidentView = z.object({
	/** `<linkId>@<openedAt>` (SRS 6.2). */
	id: z.string(),
	linkId: z.string(),
	domain: z.string(),
	url: z.string(),
	type: IncidentType,
	state: IncidentState,
	openedAt: z.string(),
	closedAt: z.string().optional(),
	closedReason: z.string().optional(),
	/** AC-07: set once closed. */
	downtimeMs: z.number().optional(),
	httpCode: z.number().optional(),
	errorType: CheckErrorType.optional(),
	ackedBy: z.string().optional(),
	ackedAt: z.string().optional(),
	note: z.string().optional(),
});
export type IncidentView = z.infer<typeof IncidentView>;

/** FR-19: who received which email about the incident (from the MAIL# log, FR-25). */
export const IncidentNotificationView = z.object({
	to: z.string(),
	kind: z.string(),
	status: z.string(),
	sentAt: z.string(),
	error: z.string().optional(),
});
export type IncidentNotificationView = z.infer<typeof IncidentNotificationView>;

export const IncidentDetail = IncidentView.extend({
	notifications: z.array(IncidentNotificationView),
});
export type IncidentDetail = z.infer<typeof IncidentDetail>;

export type IncidentPage = { items: IncidentView[]; cursor: string | null };

/** FR-19: Acknowledge with an optional note. */
export const AckInput = z
	.object({ note: z.string().trim().max(1000).optional() })
	.strict();
export type AckInput = z.infer<typeof AckInput>;

/** FR-17 / FR-18: one check in the link history. */
export const CheckView = z.object({
	checkedAt: z.string(),
	result: CheckResultKind,
	httpCode: z.number().optional(),
	responseMs: z.number(),
	finalUrl: z.string().optional(),
	errorType: CheckErrorType.optional(),
	errorMessage: z.string().optional(),
});
export type CheckView = z.infer<typeof CheckView>;

/** FR-18: one day of the 30-day uptime bar (Asia/Saigon day). */
export const UptimeDay = z.object({
	day: z.string(),
	checks: z.number(),
	up: z.number(),
	slow: z.number(),
	dead: z.number(),
	down: z.number(),
	/** Share of checks that were up or slow (0–100); undefined when there was no check. */
	uptimePct: z.number().optional(),
	avgResponseMs: z.number().optional(),
});
export type UptimeDay = z.infer<typeof UptimeDay>;

export type UptimeSummary = {
	days: UptimeDay[];
	/** Over the whole period; undefined without any check. */
	uptimePct?: number;
	checks: number;
};

/** FR-16: Check now for chosen links (≤ 100) or for every link of one domain. */
export const CheckNowInput = z
	.object({
		linkIds: z.array(z.string().min(1)).min(1).max(100).optional(),
		domain: z.string().trim().min(1).optional(),
	})
	.strict()
	.refine((v) => Boolean(v.linkIds) !== Boolean(v.domain), {
		message: "exactly one of linkIds or domain",
	});
export type CheckNowInput = z.infer<typeof CheckNowInput>;

export type CheckNowResult = {
	/** Links queued for an immediate check. */
	queued: string[];
	/** FR-04 paused, deleted or unknown links. */
	skipped: { id: string; reason: "paused" | "not_found" }[];
	/** Priority-queue messages sent (≤ 20 links each, one domain per message). */
	jobs: number;
};
