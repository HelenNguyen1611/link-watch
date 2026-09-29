import { createHash, timingSafeEqual } from "node:crypto";
import { API_KEY_HEADER } from "@linkwatch/core";
import type { MiddlewareHandler } from "hono";

const digest = (s: string) => createHash("sha256").update(s).digest();

/**
 * TẠM THỜI (Mốc 1, xóa ở Bước 18b khi có Cognito): mọi route đòi header khóa API.
 * So sánh bản băm bằng timingSafeEqual (không lộ độ dài/thời gian); khóa rỗng = từ chối hết.
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
