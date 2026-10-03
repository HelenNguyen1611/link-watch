import {
	AdminAddUserToGroupCommand,
	AdminCreateUserCommand,
	AdminDeleteUserCommand,
	AdminDisableUserCommand,
	AdminGetUserCommand,
	AdminListGroupsForUserCommand,
	AdminRemoveUserFromGroupCommand,
	AdminUserGlobalSignOutCommand,
	CognitoIdentityProviderClient,
	ListUsersCommand,
	ListUsersInGroupCommand,
	UserNotFoundException,
	UsernameExistsException,
	type UserStatusType,
	type UserType,
} from "@aws-sdk/client-cognito-identity-provider";
import type { SESv2Client } from "@aws-sdk/client-sesv2";
import type { Role } from "@linkwatch/core";
import type { Db } from "@linkwatch/core/db";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";

const POOL = "ap-southeast-1_test";
const cognito = mockClient(CognitoIdentityProviderClient);
const ACTOR = "helen@wootech.co";

const email = {
	ses: {} as SESv2Client,
	defaults: {
		sesIdentity: "watch.hueai.net",
		senderEmail: "noreply@watch.hueai.net",
	},
};

const app = (role: Role = "admin", withPool = true) =>
	createApp({
		db: {} as Db,
		auth: { kind: "local", user: { sub: "s1", email: ACTOR, role } },
		email,
		...(withPool && {
			users: {
				cognito: new CognitoIdentityProviderClient({}),
				userPoolId: POOL,
			},
		}),
	});

const req = (method: string, body?: unknown) => ({
	method,
	headers: {
		authorization: "Bearer x",
		"content-type": "application/json",
	},
	...(body !== undefined && { body: JSON.stringify(body) }),
});

const user = (
	username: string,
	mail: string,
	opts: { status?: UserStatusType; enabled?: boolean } = {},
): UserType => ({
	Username: username,
	Attributes: [{ Name: "email", Value: mail }],
	UserStatus: opts.status ?? "CONFIRMED",
	Enabled: opts.enabled ?? true,
	UserCreateDate: new Date("2026-09-30T00:00:00Z"),
});

/** A target user: AdminGetUser + its groups, and the enabled admins of the pool. */
const target = (opts: {
	groups: string[];
	enabled?: boolean;
	status?: UserStatusType;
	admins?: number;
}) => {
	cognito.on(AdminGetUserCommand).resolves({
		Username: "u-target",
		Enabled: opts.enabled ?? true,
		UserStatus: opts.status ?? "CONFIRMED",
	});
	cognito
		.on(AdminListGroupsForUserCommand)
		.resolves({ Groups: opts.groups.map((GroupName) => ({ GroupName })) });
	cognito.on(ListUsersInGroupCommand, { GroupName: "admin" }).resolves({
		Users: Array.from({ length: opts.admins ?? 2 }, (_, i) =>
			user(`a${i}`, `a${i}@abc.com`),
		),
	});
};

beforeEach(() => cognito.reset());

describe("GET /api/users — FR-29", () => {
	it("FR-29: lists users with role from groups, status and enabled flag", async () => {
		cognito.on(ListUsersCommand).resolves({
			Users: [
				user("u2", "viewer@abc.com", { status: "FORCE_CHANGE_PASSWORD" }),
				user("u1", ACTOR),
				user("u3", "ed@abc.com", { enabled: false }),
			],
		});
		cognito.on(ListUsersInGroupCommand).resolves({ Users: [] });
		cognito
			.on(ListUsersInGroupCommand, { GroupName: "admin" })
			.resolves({ Users: [user("u1", ACTOR)] });
		cognito
			.on(ListUsersInGroupCommand, { GroupName: "editor" })
			.resolves({ Users: [user("u3", "ed@abc.com")] });

		const res = await app().request("/api/users", req("GET"));
		expect(res.status).toBe(200);
		expect((await res.json()).items).toEqual([
			{
				email: "ed@abc.com",
				role: "editor",
				status: "active",
				enabled: false,
				createdAt: "2026-09-30T00:00:00.000Z",
			},
			{
				email: ACTOR,
				role: "admin",
				status: "active",
				enabled: true,
				createdAt: "2026-09-30T00:00:00.000Z",
			},
			{
				email: "viewer@abc.com",
				role: "viewer",
				status: "invited",
				enabled: true,
				createdAt: "2026-09-30T00:00:00.000Z",
			},
		]);
	});

	it("FR-29: follows Cognito pagination", async () => {
		cognito
			.on(ListUsersCommand)
			.resolvesOnce({ Users: [user("u1", "a@abc.com")], PaginationToken: "p2" })
			.resolvesOnce({ Users: [user("u2", "b@abc.com")] });
		cognito.on(ListUsersInGroupCommand).resolves({ Users: [] });
		const res = await app().request("/api/users", req("GET"));
		expect(
			(await res.json()).items.map((u: { email: string }) => u.email),
		).toEqual(["a@abc.com", "b@abc.com"]);
	});

	it("HLR-09: an editor gets 403", async () => {
		const res = await app("editor").request("/api/users", req("GET"));
		expect(res.status).toBe(403);
		expect(cognito.calls()).toHaveLength(0);
	});

	it("FR-29: without a configured pool (local) → 503", async () => {
		const res = await app("admin", false).request("/api/users", req("GET"));
		expect(res.status).toBe(503);
	});
});

describe("POST /api/users — FR-29 invite", () => {
	it("FR-29: creates the Cognito user with an email invite and adds the role group", async () => {
		cognito.on(AdminCreateUserCommand).resolves({});
		cognito.on(AdminAddUserToGroupCommand).resolves({});
		const res = await app().request(
			"/api/users",
			req("POST", { email: " New@ABC.com ", role: "editor" }),
		);
		expect(res.status).toBe(201);
		expect(await res.json()).toEqual({
			email: "new@abc.com",
			role: "editor",
			status: "invited",
			enabled: true,
		});
		expect(
			cognito.commandCalls(AdminCreateUserCommand)[0]?.args[0].input,
		).toMatchObject({
			UserPoolId: POOL,
			Username: "new@abc.com",
			DesiredDeliveryMediums: ["EMAIL"],
			UserAttributes: [
				{ Name: "email", Value: "new@abc.com" },
				{ Name: "email_verified", Value: "true" },
			],
		});
		expect(
			cognito.commandCalls(AdminAddUserToGroupCommand)[0]?.args[0].input,
		).toMatchObject({ Username: "new@abc.com", GroupName: "editor" });
	});

	it("FR-29: an existing account → 409 duplicate", async () => {
		cognito
			.on(AdminCreateUserCommand)
			.rejects(
				new UsernameExistsException({ message: "exists", $metadata: {} }),
			);
		const res = await app().request(
			"/api/users",
			req("POST", { email: "a@abc.com", role: "viewer" }),
		);
		expect(res.status).toBe(409);
		expect((await res.json()).error).toBe("duplicate");
	});

	it("FR-29: an unknown role → 400", async () => {
		const res = await app().request(
			"/api/users",
			req("POST", { email: "a@abc.com", role: "owner" }),
		);
		expect(res.status).toBe(400);
	});
});

describe("PATCH /api/users/:email — FR-29", () => {
	it("FR-29: changing the role swaps the group and signs the user out", async () => {
		target({ groups: ["viewer"] });
		const res = await app().request(
			"/api/users/ops%40abc.com",
			req("PATCH", { role: "editor" }),
		);
		expect(res.status).toBe(200);
		expect((await res.json()).role).toBe("editor");
		expect(
			cognito.commandCalls(AdminAddUserToGroupCommand)[0]?.args[0].input,
		).toMatchObject({ Username: "ops@abc.com", GroupName: "editor" });
		expect(
			cognito.commandCalls(AdminRemoveUserFromGroupCommand)[0]?.args[0].input,
		).toMatchObject({ GroupName: "viewer" });
		expect(cognito.commandCalls(AdminUserGlobalSignOutCommand)).toHaveLength(1);
	});

	it("FR-29: disabling signs the user out, then disables the account", async () => {
		target({ groups: ["editor"] });
		const res = await app().request(
			"/api/users/ops%40abc.com",
			req("PATCH", { enabled: false }),
		);
		expect(res.status).toBe(200);
		expect((await res.json()).enabled).toBe(false);
		expect(cognito.commandCalls(AdminUserGlobalSignOutCommand)).toHaveLength(1);
		expect(cognito.commandCalls(AdminDisableUserCommand)).toHaveLength(1);
	});

	it("FR-29: an admin cannot demote themself → 409 self_change", async () => {
		target({ groups: ["admin"] });
		const res = await app().request(
			`/api/users/${encodeURIComponent(ACTOR)}`,
			req("PATCH", { role: "viewer" }),
		);
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: "self_change" });
		expect(cognito.commandCalls(AdminAddUserToGroupCommand)).toHaveLength(0);
	});

	it("FR-29: the last enabled admin cannot be disabled → 409 last_admin", async () => {
		target({ groups: ["admin"], admins: 1 });
		const res = await app().request(
			"/api/users/other%40abc.com",
			req("PATCH", { enabled: false }),
		);
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: "last_admin" });
	});

	it("FR-29: unknown user → 404", async () => {
		cognito
			.on(AdminGetUserCommand)
			.rejects(new UserNotFoundException({ message: "nope", $metadata: {} }));
		cognito.on(AdminListGroupsForUserCommand).resolves({ Groups: [] });
		const res = await app().request(
			"/api/users/x%40abc.com",
			req("PATCH", { role: "viewer" }),
		);
		expect(res.status).toBe(404);
	});

	it("FR-29: an empty update → 400", async () => {
		const res = await app().request("/api/users/x%40abc.com", req("PATCH", {}));
		expect(res.status).toBe(400);
	});
});

describe("resend invite and DELETE — FR-29", () => {
	it("FR-29: resends the invite to a user still on the temporary password", async () => {
		target({ groups: ["viewer"], status: "FORCE_CHANGE_PASSWORD" });
		cognito.on(AdminCreateUserCommand).resolves({});
		const res = await app().request(
			"/api/users/new%40abc.com/resend-invite",
			req("POST"),
		);
		expect(res.status).toBe(200);
		expect(
			cognito.commandCalls(AdminCreateUserCommand)[0]?.args[0].input,
		).toMatchObject({ Username: "new@abc.com", MessageAction: "RESEND" });
	});

	it("FR-29: an active user has no invite to resend → 409", async () => {
		target({ groups: ["viewer"] });
		const res = await app().request(
			"/api/users/ops%40abc.com/resend-invite",
			req("POST"),
		);
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: "not_invited" });
	});

	it("FR-29: deletes another user", async () => {
		target({ groups: ["editor"] });
		cognito.on(AdminDeleteUserCommand).resolves({});
		const res = await app().request("/api/users/ops%40abc.com", req("DELETE"));
		expect(res.status).toBe(204);
		expect(
			cognito.commandCalls(AdminDeleteUserCommand)[0]?.args[0].input,
		).toEqual({ UserPoolId: POOL, Username: "ops@abc.com" });
	});

	it("FR-29: an admin cannot delete themself", async () => {
		target({ groups: ["admin"] });
		const res = await app().request(
			`/api/users/${encodeURIComponent(ACTOR)}`,
			req("DELETE"),
		);
		expect(res.status).toBe(409);
		expect(cognito.commandCalls(AdminDeleteUserCommand)).toHaveLength(0);
	});
});
