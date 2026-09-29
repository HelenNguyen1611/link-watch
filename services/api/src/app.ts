import { API_KEY_HEADER } from "@linkwatch/core";
import type { Db } from "@linkwatch/core/db";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { onError } from "./middleware/error";
import { sharedSecret } from "./middleware/shared-secret";
import { linkRoutes } from "./routes/links";

export type AppDeps = {
	db: Db;
	/** TEMPORARY (replaced by Cognito in step 18b). */
	getApiKey: () => Promise<string>;
	log?: (message: string, extra?: Record<string, unknown>) => void;
	/** Set only for local development (web :3000 → API :8787); production is same-origin via CloudFront. */
	corsOrigins?: string[];
};

/** Hono API under /api (CloudFront routes /api/* to API Gateway). */
export function createApp(deps: AppDeps) {
	const log = deps.log ?? (() => {});
	const app = new Hono().basePath("/api");
	if (deps.corsOrigins?.length) {
		app.use(
			"*",
			cors({
				origin: deps.corsOrigins,
				allowHeaders: [API_KEY_HEADER, "content-type"],
				allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
			}),
		);
	}
	app.use("*", sharedSecret(deps.getApiKey, ["/api/health"]));
	app.onError(onError(log));
	app.notFound((c) => c.json({ error: "not_found" }, 404));
	app.get("/health", (c) => c.json({ ok: true }));
	app.route("/links", linkRoutes(deps.db));
	return app;
}
