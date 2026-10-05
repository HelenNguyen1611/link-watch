import { z } from "zod";

const email = z
	.string()
	.trim()
	.toLowerCase()
	.pipe(z.email({ error: "invalid_email" }));

/** HLR-09 / SRS 3.3: roles, stored as Cognito groups of the same name. */
export const Role = z.enum(["admin", "editor", "viewer"]);
export type Role = z.infer<typeof Role>;

/**
 * FR-29: account state shown on the Users screen —
 * `active` = signed in and set a password, `invited` = still on the temporary password.
 */
export const UserStatus = z.enum(["active", "invited", "other"]);
export type UserStatus = z.infer<typeof UserStatus>;

/** FR-29: an admin invites a user by email with a role. */
export const UserInvite = z.object({ email, role: Role });
export type UserInvite = z.infer<typeof UserInvite>;

/** FR-20: switch a user's alerts on or off (Users screen). */
export const UserAlertsInput = z.object({ on: z.boolean() }).strict();
export type UserAlertsInput = z.infer<typeof UserAlertsInput>;

/** FR-29: change the role and/or enable or disable the account. */
export const UserUpdate = z
	.object({ role: Role, enabled: z.boolean() })
	.partial()
	.refine((v) => v.role !== undefined || v.enabled !== undefined, {
		error: "empty_update",
	});
export type UserUpdate = z.infer<typeof UserUpdate>;

export const UserView = z.object({
	email: z.string(),
	role: Role,
	status: UserStatus,
	enabled: z.boolean(),
	/** FR-20: gets every incident, reminder and recovery email. */
	alerts: z.boolean(),
	createdAt: z.string().optional(),
});
export type UserView = z.infer<typeof UserView>;
