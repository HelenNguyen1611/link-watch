import { DEFAULT_SCHEDULE_ID } from "./schema/schedule";
import { Role } from "./schema/user";

/** HLR-09 / SRS 3.3: what a role may do. Reading is open to every signed-in user. */
export type Action =
	| "view"
	/** Links, domains, recipients, schedule templates other than "default". */
	| "edit"
	/** Acknowledge, "Fixed — check again" in the app, Check now. */
	| "handle_incidents"
	/** Email settings, test email, the "default" schedule (FR-11). */
	| "configure"
	/** FR-29: invite, change role, disable, delete users. */
	| "manage_users";

const ALLOWED: Record<Role, ReadonlySet<Action>> = {
	admin: new Set([
		"view",
		"edit",
		"handle_incidents",
		"configure",
		"manage_users",
	]),
	editor: new Set(["view", "edit", "handle_incidents"]),
	viewer: new Set(["view"]),
};

/** HLR-09: true when `role` may perform `action`. */
export function can(role: Role, action: Action): boolean {
	return ALLOWED[role].has(action);
}

/** FR-11 / FR-12: editors manage schedule templates; only an admin changes the system default. */
export function scheduleAction(scheduleId: string): Action {
	return scheduleId === DEFAULT_SCHEDULE_ID ? "configure" : "edit";
}

const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };

/**
 * HLR-09: role from Cognito groups (highest wins); no known group → viewer.
 * Accepts an array (raw ID token) or the string the HTTP API JWT authorizer
 * forwards for array claims, e.g. `"[admin editor]"`.
 */
export function roleFromGroups(groups: unknown): Role {
	const list = Array.isArray(groups)
		? groups.map(String)
		: typeof groups === "string"
			? groups.replace(/^\[|\]$/g, "").split(/[\s,]+/)
			: [];
	let best: Role = "viewer";
	for (const g of list) {
		const parsed = Role.safeParse(g.trim().toLowerCase());
		if (parsed.success && RANK[parsed.data] > RANK[best]) best = parsed.data;
	}
	return best;
}

export type UserChange =
	| { kind: "update"; role?: Role; enabled?: boolean }
	| { kind: "delete" };

export type UserChangeError = "self_change" | "last_admin";

/**
 * FR-29: guards against locking the system out —
 * an admin cannot demote, disable or delete themself, and at least one
 * enabled admin must remain. `enabledAdmins` counts enabled admins before the change.
 */
export function checkUserChange(input: {
	actorEmail: string;
	target: { email: string; role: Role; enabled: boolean };
	change: UserChange;
	enabledAdmins: number;
}): UserChangeError | undefined {
	const { actorEmail, target, change, enabledAdmins } = input;
	const removesAdmin =
		target.role === "admin" &&
		target.enabled &&
		(change.kind === "delete" ||
			(change.role !== undefined && change.role !== "admin") ||
			change.enabled === false);
	if (!removesAdmin) return undefined;
	if (target.email.toLowerCase() === actorEmail.toLowerCase())
		return "self_change";
	if (enabledAdmins <= 1) return "last_admin";
	return undefined;
}
