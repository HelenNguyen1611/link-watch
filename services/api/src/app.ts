import type { Db } from "@linkwatch/core/db";
import type { SendPriorityJob, SnapshotStore } from "@linkwatch/core/usecases";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { type AuthMode, type AuthVariables, auth } from "./middleware/auth";
import { authorize } from "./middleware/authorize";
import { onError } from "./middleware/error";
import { domainRoutes } from "./routes/domains";
import { incidentRoutes } from "./routes/incidents";
import { linkRoutes } from "./routes/links";
import { publicClaimRoutes } from "./routes/public-claims";
import { recipientRoutes } from "./routes/recipients";
import { scheduleRoutes } from "./routes/schedules";
import { type EmailDeps, settingsRoutes } from "./routes/settings";
import { type UserDirectory, userRoutes } from "./routes/users";

export type AppDeps = {
	db: Db;
	/** FR-28: Cognito claims from API Gateway, or a fake user when running locally. */
	auth: AuthMode;
	/** FR-26: SES client and deployment defaults for Settings and the test email. */
	email: EmailDeps;
	/** FR-16: sends Check now jobs to the priority queue; undefined → Check now answers 503. */
	sendPriorityJob?: SendPriorityJob;
	/** FR-29: Cognito User Pool for the Users screen; undefined → /api/users answers 503. */
	users?: UserDirectory;
	/** Step 19b: stored links snapshot; undefined → built on the fly (local API). */
	snapshot?: SnapshotStore;
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
	const publicPrefixes = ["/api/health", "/api/public"];
	app.use("*", auth(deps.auth, publicPrefixes));
	// HLR-09: role check for every signed-in route.
	app.use("*", authorize(publicPrefixes));
	app.onError(onError(log));
	app.notFound((c) => c.json({ error: "not_found" }, 404));
	app.get("/health", (c) => c.json({ ok: true }));
	app.route("/links", linkRoutes(deps.db, deps.sendPriorityJob, deps.snapshot));
	app.route("/incidents", incidentRoutes(deps.db, deps.sendPriorityJob));
	app.route("/public/claims", publicClaimRoutes(deps.db, deps.sendPriorityJob));
	app.route("/schedules", scheduleRoutes(deps.db));
	app.route("/domains", domainRoutes(deps.db, deps.snapshot));
	app.route("/recipients", recipientRoutes(deps.db));
	app.route("/settings", settingsRoutes(deps.db, deps.email));
	app.route("/users", userRoutes(deps.users));
	return app;
}
