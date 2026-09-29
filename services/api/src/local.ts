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
	// Static export không có rewrites: web :3000 gọi thẳng API :8787 nên cần CORS khi chạy local.
	corsOrigins: [process.env.WEB_ORIGIN ?? "http://localhost:3000"],
});
serve({ fetch: app.fetch, port }, () =>
	console.log(`API local: http://localhost:${port}/api (khóa: ${apiKey})`),
);
