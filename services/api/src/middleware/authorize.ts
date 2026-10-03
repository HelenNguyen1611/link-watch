import { type Action, can, scheduleAction } from "@linkwatch/core";
import type { MiddlewareHandler } from "hono";
import type { AuthVariables } from "./auth";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Writes that only touch incidents (SRS 3.3: an editor acknowledges and reports fixes). */
const INCIDENT_ROUTES = [
	/^\/api\/incidents\/resolve-claim$/,
	/^\/api\/incidents\/[^/]+\/ack$/,
	/^\/api\/links\/check-now$/,
];

/** POST routes that only read (body carries the keys to look up). */
const READ_POSTS = [/^\/api\/links\/fresh$/];

/**
 * HLR-09: the action a request needs. Users are admin-only even to list; any other
 * write defaults to "edit", so a new write route is never open to viewers by mistake.
 */
export function requiredAction(method: string, path: string): Action {
	if (path === "/api/users" || path.startsWith("/api/users/"))
		return "manage_users";
	if (READ_METHODS.has(method) || READ_POSTS.some((r) => r.test(path)))
		return "view";
	if (path === "/api/settings" || path.startsWith("/api/settings/"))
		return "configure";
	const schedule = /^\/api\/schedules\/([^/]+)$/.exec(path);
	if (schedule?.[1]) return scheduleAction(decodeURIComponent(schedule[1]));
	if (INCIDENT_ROUTES.some((r) => r.test(path))) return "handle_incidents";
	return "edit";
}

/** HLR-09: 403 when the signed-in user's role may not perform the request (runs after `auth`). */
export function authorize(
	publicPrefixes: string[],
): MiddlewareHandler<{ Variables: AuthVariables }> {
	return async (c, next) => {
		const path = c.req.path;
		if (c.req.method === "OPTIONS") return next();
		if (publicPrefixes.some((p) => path === p || path.startsWith(`${p}/`)))
			return next();
		const action = requiredAction(c.req.method, path);
		if (!can(c.get("user").role, action))
			return c.json({ error: "forbidden", required: action }, 403);
		return next();
	};
}
