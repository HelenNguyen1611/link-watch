import { describe, expect, it } from "vitest";
import { can, checkUserChange, roleFromGroups, scheduleAction } from "./roles";
import { UserInvite, UserUpdate } from "./schema/user";

describe("can — HLR-09, SRS 3.3", () => {
	it("HLR-09: a viewer can only view", () => {
		expect(can("viewer", "view")).toBe(true);
		expect(can("viewer", "edit")).toBe(false);
		expect(can("viewer", "handle_incidents")).toBe(false);
		expect(can("viewer", "configure")).toBe(false);
		expect(can("viewer", "manage_users")).toBe(false);
	});

	it("HLR-09: an editor edits links/domains/recipients and handles incidents, not settings or users", () => {
		expect(can("editor", "view")).toBe(true);
		expect(can("editor", "edit")).toBe(true);
		expect(can("editor", "handle_incidents")).toBe(true);
		expect(can("editor", "configure")).toBe(false);
		expect(can("editor", "manage_users")).toBe(false);
	});

	it("HLR-09: an admin can do everything", () => {
		for (const action of [
			"view",
			"edit",
			"handle_incidents",
			"configure",
			"manage_users",
		] as const)
			expect(can("admin", action)).toBe(true);
	});

	it("FR-11: only an admin changes the default schedule; other templates are editor work", () => {
		expect(scheduleAction("default")).toBe("configure");
		expect(scheduleAction("every-15")).toBe("edit");
	});
});

describe("roleFromGroups — HLR-09", () => {
	it("HLR-09: no group → viewer", () => {
		expect(roleFromGroups(undefined)).toBe("viewer");
		expect(roleFromGroups([])).toBe("viewer");
		expect(roleFromGroups("")).toBe("viewer");
	});

	it("HLR-09: the highest of several groups wins", () => {
		expect(roleFromGroups(["viewer", "admin", "editor"])).toBe("admin");
		expect(roleFromGroups(["viewer", "editor"])).toBe("editor");
	});

	it("HLR-09: parses the HTTP API authorizer string form of array claims", () => {
		expect(roleFromGroups("[editor]")).toBe("editor");
		expect(roleFromGroups("[viewer admin]")).toBe("admin");
	});

	it("HLR-09: unknown groups are ignored", () => {
		expect(roleFromGroups(["ops", "Editor"])).toBe("editor");
		expect(roleFromGroups(["superuser"])).toBe("viewer");
	});
});

describe("checkUserChange — FR-29", () => {
	const admin = {
		email: "helen@wootech.co",
		role: "admin",
		enabled: true,
	} as const;
	const other = { email: "ops@abc.com", role: "admin", enabled: true } as const;

	it("FR-29: an admin cannot demote, disable or delete themself", () => {
		const base = {
			actorEmail: "Helen@wootech.co",
			target: admin,
			enabledAdmins: 2,
		};
		expect(
			checkUserChange({ ...base, change: { kind: "update", role: "editor" } }),
		).toBe("self_change");
		expect(
			checkUserChange({ ...base, change: { kind: "update", enabled: false } }),
		).toBe("self_change");
		expect(checkUserChange({ ...base, change: { kind: "delete" } })).toBe(
			"self_change",
		);
	});

	it("FR-29: the last enabled admin cannot be removed", () => {
		expect(
			checkUserChange({
				actorEmail: "helen@wootech.co",
				target: other,
				change: { kind: "delete" },
				enabledAdmins: 1,
			}),
		).toBe("last_admin");
	});

	it("FR-29: another admin can be demoted while one admin remains", () => {
		expect(
			checkUserChange({
				actorEmail: "helen@wootech.co",
				target: other,
				change: { kind: "update", role: "viewer" },
				enabledAdmins: 2,
			}),
		).toBeUndefined();
	});

	it("FR-29: changes to non-admins, or keeping the admin role, are allowed", () => {
		const base = { actorEmail: "helen@wootech.co", enabledAdmins: 1 };
		expect(
			checkUserChange({
				...base,
				target: { email: "v@abc.com", role: "viewer", enabled: true },
				change: { kind: "delete" },
			}),
		).toBeUndefined();
		expect(
			checkUserChange({
				...base,
				target: admin,
				change: { kind: "update", role: "admin", enabled: true },
			}),
		).toBeUndefined();
	});
});

describe("user schemas — FR-29", () => {
	it("FR-29: an invite needs a valid email and a known role; email is normalised", () => {
		expect(
			UserInvite.parse({ email: " Ops@ABC.com ", role: "editor" }),
		).toEqual({
			email: "ops@abc.com",
			role: "editor",
		});
		expect(UserInvite.safeParse({ email: "x", role: "editor" }).success).toBe(
			false,
		);
		expect(
			UserInvite.safeParse({ email: "a@b.co", role: "owner" }).success,
		).toBe(false);
	});

	it("FR-29: an update must change something", () => {
		expect(UserUpdate.safeParse({}).success).toBe(false);
		expect(UserUpdate.parse({ enabled: false })).toEqual({ enabled: false });
	});
});
