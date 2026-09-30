import { z } from "zod";

/** Root domain (FR-07): hostname only, lowercased; IPv6 as [..] like in a URL. */
export const DomainName = z
	.string()
	.trim()
	.toLowerCase()
	.min(1)
	.max(253)
	.regex(/^(\[[0-9a-f:.]+\]|[a-z0-9-]+(\.[a-z0-9-]+)*)$/, "Invalid domain");
export type DomainName = z.infer<typeof DomainName>;

const Email = z.string().trim().toLowerCase().pipe(z.email());

const optionalText = (max: number) =>
	z
		.string()
		.trim()
		.max(max)
		.optional()
		.transform((v) => (v ? v : undefined));

/** FR-08: user-editable domain attributes. */
export const DomainInput = z.object({
	displayName: optionalText(200),
	description: optionalText(1000),
	owner: Email.optional(),
	/** FR-20: alert recipients of the domain. */
	recipients: z
		.array(Email)
		.max(50)
		.default([])
		.transform((list) => [...new Set(list)]),
	/** FR-13: own schedule; the default schedule applies when absent. */
	scheduleId: z.string().min(1).optional(),
	enabled: z.boolean().default(true),
	/** SRS 5.1: send email when a link is Slow (off by default). */
	slowAlert: z.boolean().default(false),
	/** SRS 3.4: treat 403 from a WAF as normal. */
	ignoreWaf403: z.boolean().default(false),
});
export type DomainInput = z.infer<typeof DomainInput>;

const clearable = (max: number) =>
	z
		.union([z.string().trim().max(max), z.null()])
		.transform((v) => (v ? v : null));

/** FR-08 / FR-13 / SRS 3.4: partial edit of a domain ("" or null clears a text or the schedule). */
export const DomainUpdate = z
	.object({
		displayName: clearable(200),
		description: clearable(1000),
		owner: z
			.union([z.literal(""), z.null(), Email])
			.transform((v) => (v ? v : null)),
		scheduleId: z.union([z.string().min(1), z.null()]),
		enabled: z.boolean(),
		slowAlert: z.boolean(),
		ignoreWaf403: z.boolean(),
	})
	.partial()
	.strict();
export type DomainUpdate = z.infer<typeof DomainUpdate>;
export type DomainUpdateRaw = z.input<typeof DomainUpdate>;
