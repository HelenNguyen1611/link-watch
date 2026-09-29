/**
 * Chạy API ở máy: `pnpm dev:api` (cần `pnpm db:local && pnpm db:init`).
 * Khóa API tạm lấy từ LOCAL_API_KEY (mặc định "dev").
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
});
serve({ fetch: app.fetch, port }, () =>
	console.log(`API local: http://localhost:${port}/api (khóa: ${apiKey})`),
);
