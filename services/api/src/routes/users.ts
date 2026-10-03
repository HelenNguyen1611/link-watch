import {
	AdminAddUserToGroupCommand,
	AdminCreateUserCommand,
	AdminDeleteUserCommand,
	AdminDisableUserCommand,
	AdminEnableUserCommand,
	AdminGetUserCommand,
	AdminListGroupsForUserCommand,
	AdminRemoveUserFromGroupCommand,
	AdminUserGlobalSignOutCommand,
	type CognitoIdentityProviderClient,
	ListUsersCommand,
	ListUsersInGroupCommand,
	type UserType,
} from "@aws-sdk/client-cognito-identity-provider";
import {
	checkUserChange,
	Role,
	roleFromGroups,
	type UserChange,
	UserInvite,
	type UserStatus,
	UserUpdate,
	type UserView,
} from "@linkwatch/core";
import { Hono } from "hono";
import type { AuthVariables } from "../middleware/auth";

/** FR-29: the Cognito User Pool that holds the accounts (groups = roles, HLR-09). */
export type UserDirectory = {
	cognito: CognitoIdentityProviderClient;
	userPoolId: string;
};

const ROLES = Role.options;

const statusOf = (s: string | undefined): UserStatus =>
	s === "CONFIRMED"
		? "active"
		: s === "FORCE_CHANGE_PASSWORD"
			? "invited"
			: "other";

const emailOf = (u: UserType) =>
	u.Attributes?.find((a) => a.Name === "email")?.Value?.toLowerCase();

const isNamed = (err: unknown, name: string) =>
	(err as { name?: unknown } | null)?.name === name;

/** FR-29: user management through the Cognito admin API (admin only, see authorize). */
export function userRoutes(dir?: UserDirectory) {
	const app = new Hono<{ Variables: AuthVariables }>();
	if (!dir)
		return app.all("*", (c) => c.json({ error: "users_unavailable" }, 503));
	const { cognito, userPoolId: UserPoolId } = dir;

	const pages = async <T>(
		fetch: (token?: string) => Promise<{ items: T[]; next?: string }>,
	) => {
		const all: T[] = [];
		let token: string | undefined;
		do {
			const page = await fetch(token);
			all.push(...page.items);
			token = page.next;
		} while (token);
		return all;
	};

	const groupMembers = (GroupName: Role) =>
		pages(async (NextToken) => {
			const r = await cognito.send(
				new ListUsersInGroupCommand({ UserPoolId, GroupName, NextToken }),
			);
			return { items: r.Users ?? [], next: r.NextToken };
		});

	const listUsers = async (): Promise<UserView[]> => {
		const [users, ...members] = await Promise.all([
			pages(async (PaginationToken) => {
				const r = await cognito.send(
					new ListUsersCommand({ UserPoolId, PaginationToken }),
				);
				return { items: r.Users ?? [], next: r.PaginationToken };
			}),
			...ROLES.map(groupMembers),
		]);
		const groups = new Map<string, Role[]>();
		ROLES.forEach((role, i) => {
			for (const u of members[i] ?? [])
				if (u.Username)
					groups.set(u.Username, [...(groups.get(u.Username) ?? []), role]);
		});
		return users
			.flatMap((u) => {
				const email = emailOf(u);
				if (!email) return [];
				return [
					{
						email,
						role: roleFromGroups(groups.get(u.Username ?? "") ?? []),
						status: statusOf(u.UserStatus),
						enabled: u.Enabled ?? true,
						...(u.UserCreateDate && {
							createdAt: u.UserCreateDate.toISOString(),
						}),
					},
				];
			})
			.sort((a, b) => a.email.localeCompare(b.email));
	};

	/** Username accepts the email alias (the pool signs in by email). */
	const getUser = async (Username: string) => {
		const [user, groups] = await Promise.all([
			cognito.send(new AdminGetUserCommand({ UserPoolId, Username })),
			cognito.send(new AdminListGroupsForUserCommand({ UserPoolId, Username })),
		]);
		const names = (groups.Groups ?? []).flatMap((g) =>
			g.GroupName ? [g.GroupName] : [],
		);
		return {
			email: Username,
			role: roleFromGroups(names),
			groups: names,
			enabled: user.Enabled ?? true,
			status: statusOf(user.UserStatus),
		};
	};

	const enabledAdmins = async () =>
		(await groupMembers("admin")).filter((u) => u.Enabled !== false).length;

	/** FR-29: refuses changes that would lock the actor or the whole system out. */
	const guard = async (
		actorEmail: string,
		target: Awaited<ReturnType<typeof getUser>>,
		change: UserChange,
	) =>
		checkUserChange({
			actorEmail,
			target,
			change,
			enabledAdmins: target.role === "admin" ? await enabledAdmins() : 0,
		});

	const setRole = async (Username: string, role: Role, current: string[]) => {
		await cognito.send(
			new AdminAddUserToGroupCommand({ UserPoolId, Username, GroupName: role }),
		);
		for (const GroupName of current)
			if (
				GroupName !== role &&
				(ROLES as readonly string[]).includes(GroupName)
			)
				await cognito.send(
					new AdminRemoveUserFromGroupCommand({
						UserPoolId,
						Username,
						GroupName,
					}),
				);
	};

	const target = (raw: string) => decodeURIComponent(raw).trim().toLowerCase();

	return app
		.get("/", async (c) => c.json({ items: await listUsers() }))
		.post("/", async (c) => {
			const { email, role } = UserInvite.parse(await c.req.json());
			try {
				await cognito.send(
					new AdminCreateUserCommand({
						UserPoolId,
						Username: email,
						UserAttributes: [
							{ Name: "email", Value: email },
							{ Name: "email_verified", Value: "true" },
						],
						DesiredDeliveryMediums: ["EMAIL"],
					}),
				);
			} catch (err) {
				if (isNamed(err, "UsernameExistsException"))
					return c.json(
						{ error: "duplicate", message: `${email} already has an account` },
						409,
					);
				throw err;
			}
			await setRole(email, role, []);
			const view: UserView = { email, role, status: "invited", enabled: true };
			return c.json(view, 201);
		})
		.patch("/:email", async (c) => {
			const email = target(c.req.param("email"));
			const input = UserUpdate.parse(await c.req.json());
			const user = await getUser(email);
			const error = await guard(c.get("user").email, user, {
				kind: "update",
				...input,
			});
			if (error) return c.json({ error }, 409);

			const roleChanged = input.role !== undefined && input.role !== user.role;
			if (input.role !== undefined)
				await setRole(email, input.role, user.groups);
			// Revoke refresh tokens so the new role / disabled state applies at the next refresh (≤ 1 h).
			if (roleChanged || (input.enabled === false && user.enabled))
				await cognito.send(
					new AdminUserGlobalSignOutCommand({ UserPoolId, Username: email }),
				);
			if (input.enabled !== undefined && input.enabled !== user.enabled)
				await cognito.send(
					input.enabled
						? new AdminEnableUserCommand({ UserPoolId, Username: email })
						: new AdminDisableUserCommand({ UserPoolId, Username: email }),
				);
			const view: UserView = {
				email,
				role: input.role ?? user.role,
				status: user.status,
				enabled: input.enabled ?? user.enabled,
			};
			return c.json(view);
		})
		.post("/:email/resend-invite", async (c) => {
			const email = target(c.req.param("email"));
			const user = await getUser(email);
			if (user.status !== "invited")
				return c.json({ error: "not_invited" }, 409);
			await cognito.send(
				new AdminCreateUserCommand({
					UserPoolId,
					Username: email,
					MessageAction: "RESEND",
					DesiredDeliveryMediums: ["EMAIL"],
				}),
			);
			return c.json({ status: "sent", to: email });
		})
		.delete("/:email", async (c) => {
			const email = target(c.req.param("email"));
			const user = await getUser(email);
			const error = await guard(c.get("user").email, user, { kind: "delete" });
			if (error) return c.json({ error }, 409);
			await cognito.send(
				new AdminDeleteUserCommand({ UserPoolId, Username: email }),
			);
			return c.body(null, 204);
		});
}
