import type { Db } from "@linkwatch/core/db";
import { Hono } from "hono";
import { onError } from "./middleware/error";
import { sharedSecret } from "./middleware/shared-secret";
import { linkRoutes } from "./routes/links";

export type AppDeps = {
	db: Db;
	/** TẠM THỜI (Bước 18b thay bằng Cognito). */
	getApiKey: () => Promise<string>;
	log?: (message: string, extra?: Record<string, unknown>) => void;
};

/** API Hono dưới /api (CloudFront chuyển /api/* sang API Gateway). */
export function createApp(deps: AppDeps) {
	const log = deps.log ?? (() => {});
	const app = new Hono().basePath("/api");
	app.use("*", sharedSecret(deps.getApiKey, ["/api/health"]));
	app.onError(onError(log));
	app.notFound((c) => c.json({ error: "not_found" }, 404));
	app.get("/health", (c) => c.json({ ok: true }));
	app.route("/links", linkRoutes(deps.db));
	return app;
}
