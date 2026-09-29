import { z } from "zod";

/** FR-01: request method. */
export const HttpMethod = z.enum(["GET", "HEAD"]);
export type HttpMethod = z.infer<typeof HttpMethod>;

/** SRS 5.1: result of one check. */
export const CheckResultKind = z.enum(["up", "slow", "dead", "down"]);
export type CheckResultKind = z.infer<typeof CheckResultKind>;

/**
 * Current link status: `pending` = never checked yet,
 * `suspect` = suspected after the first failure (SRS 5.2 step 1). Pausing is a separate `paused` flag (FR-04).
 */
export const LinkStatus = z.enum([
	"pending",
	"up",
	"slow",
	"dead",
	"down",
	"suspect",
]);
export type LinkStatus = z.infer<typeof LinkStatus>;

/** SRS 6.2: Open / Verifying / Closed. */
export const IncidentState = z.enum(["open", "verifying", "closed"]);
export type IncidentState = z.infer<typeof IncidentState>;

/** Only real failures open an incident; Slow does not (SRS 5.1). */
export const IncidentType = z.enum(["dead", "down"]);
export type IncidentType = z.infer<typeof IncidentType>;

/** SRS 5.1: error type of one check (FR-17). */
export const CheckErrorType = z.enum([
	// Site down
	"dns",
	"timeout",
	"connection_refused",
	"ssl",
	"network",
	"http_5xx",
	// Dead link
	"http_4xx",
	"unexpected_status",
	"too_many_redirects",
	"keyword_missing",
	"blocked_private_address",
]);
export type CheckErrorType = z.infer<typeof CheckErrorType>;

/** FR-09: aggregate domain status. */
export const DomainStatus = z.enum(["normal", "warning", "error", "down"]);
export type DomainStatus = z.infer<typeof DomainStatus>;
