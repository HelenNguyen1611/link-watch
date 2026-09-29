/**
 * Run the API locally: `pnpm dev:api` (requires `pnpm db:local && pnpm db:init`).
 * The temporary API key comes from LOCAL_API_KEY (default "dev").
 */
import { serve } from "@hono/node-server";
import { createDb } from "@linkwatch/core/db";
import { createApp } from "./app";

process.env.DYNAMODB_ENDPOINT ??= "http://localhost:8000";
process.env.TABLE_NAME ??= "linkwatch";
const apiKey = process.env.LOCAL_API_KEY ?? "dev";
const port = Number(process.env.PORT ?? 8787);

const app = createApp({
	db: createDb(),
	getApiKey: async () => apiKey,
	log: console.error,
	// Static export has no rewrites: web :3000 calls API :8787 directly, so local runs need CORS.
	corsOrigins: [process.env.WEB_ORIGIN ?? "http://localhost:3000"],
});
serve({ fetch: app.fetch, port }, () =>
	console.log(`API local: http://localhost:${port}/api (key: ${apiKey})`),
);
