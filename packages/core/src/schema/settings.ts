import { z } from "zod";

const email = z
	.string()
	.trim()
	.toLowerCase()
	.pipe(z.email({ error: "invalid_email" }));

/** FR-20: a recipient of a domain or of one link. */
export const RecipientScope = z.enum(["DOMAIN", "LINK"]);
export type RecipientScope = z.infer<typeof RecipientScope>;

export const RecipientTarget = z.object({
	scope: RecipientScope,
	/** Domain name (DOMAIN) or link id (LINK). */
	target: z.string().trim().min(1),
});
export type RecipientTarget = z.infer<typeof RecipientTarget>;

export const RecipientInput = RecipientTarget.extend({
	email,
	name: z.string().trim().min(1).max(100).optional(),
});
export type RecipientInput = z.infer<typeof RecipientInput>;

export const RecipientView = z.object({
	scope: RecipientScope,
	target: z.string(),
	email: z.string(),
	name: z.string().optional(),
});
export type RecipientView = z.infer<typeof RecipientView>;

/** FR-20, FR-23, FR-26: fields the admin can change on SCR-08 (all optional: PATCH). */
export const SettingsInput = z
	.object({
		senderEmail: email,
		senderName: z.string().trim().min(1).max(64),
		defaultAdminEmail: email,
		remindersEnabled: z.boolean(),
		reminderIntervalHours: z.number().int().min(1).max(720),
	})
	.partial()
	.strict();
export type SettingsInput = z.infer<typeof SettingsInput>;

/** Settings as used by the Alert Lambda and shown on SCR-08, defaults applied. */
export const SettingsView = z.object({
	senderEmail: z.string(),
	senderName: z.string(),
	defaultAdminEmail: z.string().optional(),
	remindersEnabled: z.boolean(),
	reminderIntervalHours: z.number(),
	/** FR-26: the verified SES identity; the sender address must belong to it. */
	sesIdentity: z.string(),
});
export type SettingsView = z.infer<typeof SettingsView>;

/** FR-26: deployment defaults (infra config) used until the admin saves Settings. */
export type SettingsDefaults = {
	sesIdentity: string;
	senderEmail: string;
	defaultAdminEmail?: string;
};

/** FR-23 default. */
const DEFAULT_REMINDER_HOURS = 24;

/** Merges the stored Settings item (may not exist yet) with the deployment defaults. */
export function effectiveSettings(
	stored:
		| {
				senderEmail?: string;
				senderName?: string;
				defaultAdminEmail?: string;
				remindersEnabled?: boolean;
				reminderIntervalHours?: number;
		  }
		| null
		| undefined,
	defaults: SettingsDefaults,
): SettingsView {
	const admin = stored?.defaultAdminEmail ?? defaults.defaultAdminEmail;
	return {
		senderEmail: stored?.senderEmail ?? defaults.senderEmail,
		senderName: stored?.senderName ?? "LinkWatch",
		...(admin && { defaultAdminEmail: admin }),
		remindersEnabled: stored?.remindersEnabled ?? true,
		reminderIntervalHours:
			stored?.reminderIntervalHours ?? DEFAULT_REMINDER_HOURS,
		sesIdentity: defaults.sesIdentity,
	};
}

/** FR-26: the sender must be the verified domain identity or one of its subdomains. */
export function isSenderAllowed(senderEmail: string, sesIdentity: string) {
	const domain = senderEmail.split("@")[1]?.toLowerCase() ?? "";
	const identity = sesIdentity.toLowerCase();
	return domain === identity || domain.endsWith(`.${identity}`);
}

/** RFC 5322 From header: `"LinkWatch" <noreply@watch.hueai.net>`. */
export const fromHeader = (s: { senderName: string; senderEmail: string }) =>
	`"${s.senderName.replaceAll('"', "")}" <${s.senderEmail}>`;
