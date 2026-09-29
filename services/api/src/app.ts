import type { Db } from "@linkwatch/core/db";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { type AuthMode, type AuthVariables, auth } from "./middleware/auth";
import { onError } from "./middleware/error";
import { linkRoutes } from "./routes/links";

export type AppDeps = {
	db: Db;
	/** FR-28: Cognito claims from API Gateway, or a fake user when running locally. */
	auth: AuthMode;
	log?: (message: string, extra?: Record<string, unknown>) => void;
	/** Set only for local development (web :3000 → API :8787); production is same-origin via CloudFront. */
	corsOrigins?: string[];
};

/** Hono API under /api (CloudFront routes /api/* to API Gateway). */
export function createApp(deps: AppDeps) {
	const log = deps.log ?? (() => {});
	const app = new Hono<{ Variables: AuthVariables }>().basePath("/api");
	if (deps.corsOrigins?.length) {
		app.use(
			"*",
			cors({
				origin: deps.corsOrigins,
				allowHeaders: ["authorization", "content-type"],
				allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
			}),
		);
	}
	// /api/public/*: token links from emails (milestone 3), no sign-in.
	app.use("*", auth(deps.auth, ["/api/health", "/api/public"]));
	app.onError(onError(log));
	app.notFound((c) => c.json({ error: "not_found" }, 404));
	app.get("/health", (c) => c.json({ ok: true }));
	app.route("/links", linkRoutes(deps.db));
	return app;
}
