import { createHash, timingSafeEqual } from "node:crypto";
import { API_KEY_HEADER } from "@linkwatch/core";
import type { MiddlewareHandler } from "hono";

const digest = (s: string) => createHash("sha256").update(s).digest();

/**
 * TEMPORARY (milestone 1, removed in step 18b with Cognito): every route requires the API key header.
 * Compares hashes with timingSafeEqual (leaks neither length nor timing); an empty key rejects everything.
 */
export function sharedSecret(
	getApiKey: () => Promise<string>,
	publicPaths: string[],
): MiddlewareHandler {
	return async (c, next) => {
		if (publicPaths.includes(c.req.path)) return next();
		const expected = await getApiKey();
		const provided = c.req.header(API_KEY_HEADER) ?? "";
		if (!expected || !timingSafeEqual(digest(provided), digest(expected))) {
			return c.json({ error: "unauthorized" }, 401);
		}
		return next();
	};
}
