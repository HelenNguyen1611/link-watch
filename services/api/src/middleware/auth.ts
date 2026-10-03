import { type Role, roleFromGroups } from "@linkwatch/core";
import type { MiddlewareHandler } from "hono";

/** FR-28 + HLR-09: the signed-in Cognito user and their role (from `cognito:groups`). */
export type AuthUser = { sub: string; email: string; role: Role };

export type AuthMode =
	/** Production: API Gateway's JWT authorizer already verified the Cognito ID token. */
	| { kind: "apiGateway" }
	/** Local development: any `Authorization: Bearer …` header signs in as `user` (admin unless set). */
	| { kind: "local"; user: Omit<AuthUser, "role"> & { role?: Role } };

export type AuthVariables = { user: AuthUser };

type JwtClaims = Record<
	string,
	string | number | boolean | string[] | undefined
>;

/** Claims forwarded by the HTTP API JWT authorizer (payload format 2.0). */
function claimsOf(env: unknown): JwtClaims | undefined {
	const event = (env as { event?: unknown } | undefined)?.event as
		| {
				requestContext?: {
					authorizer?: { jwt?: { claims?: JwtClaims } };
				};
		  }
		| undefined;
	return event?.requestContext?.authorizer?.jwt?.claims;
}

const unauthorized = { error: "unauthorized" } as const;

/**
 * FR-28 / NFR-07: requires a signed-in user on every route except `publicPrefixes`.
 * With API Gateway the token is verified before the Lambda runs; this middleware is
 * defence in depth (no claims → 401) and exposes the user as `c.get("user")`.
 */
export function auth(
	mode: AuthMode,
	publicPrefixes: string[],
): MiddlewareHandler<{ Variables: AuthVariables }> {
	return async (c, next) => {
		const path = c.req.path;
		if (c.req.method === "OPTIONS") return next();
		if (publicPrefixes.some((p) => path === p || path.startsWith(`${p}/`)))
			return next();

		if (mode.kind === "local") {
			if (!/^Bearer\s+\S+/.test(c.req.header("authorization") ?? ""))
				return c.json(unauthorized, 401);
			c.set("user", { role: "admin", ...mode.user });
			return next();
		}

		const claims = claimsOf(c.env);
		const sub = claims?.sub;
		const email = claims?.email;
		if (
			claims?.token_use !== "id" ||
			typeof sub !== "string" ||
			typeof email !== "string"
		)
			return c.json(unauthorized, 401);
		c.set("user", {
			sub,
			email,
			role: roleFromGroups(claims["cognito:groups"]),
		});
		return next();
	};
}
