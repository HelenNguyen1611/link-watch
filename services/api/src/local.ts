/**
 * Run the API locally: `pnpm dev:api` (requires `pnpm db:local && pnpm db:init`).
 * No Cognito locally: any `Authorization: Bearer …` header signs in as LOCAL_USER_EMAIL.
 */
import { SESv2Client } from "@aws-sdk/client-sesv2";
import { serve } from "@hono/node-server";
import { createDb } from "@linkwatch/core/db";
import { createApp } from "./app";

process.env.DYNAMODB_ENDPOINT ??= "http://localhost:8000";
process.env.TABLE_NAME ??= "linkwatch";
const email = process.env.LOCAL_USER_EMAIL ?? "dev@example.com";
const port = Number(process.env.PORT ?? 8787);

const app = createApp({
	db: createDb(),
	auth: { kind: "local", user: { sub: "local-dev", email } },
	// The test email really goes through SES when local AWS credentials exist.
	email: {
		ses: new SESv2Client({
			region: process.env.AWS_REGION ?? "ap-southeast-1",
		}),
		defaults: {
			sesIdentity: "watch.hueai.net",
			senderEmail: "noreply@watch.hueai.net",
			defaultAdminEmail: email,
		},
	},
	log: console.error,
	// Static export has no rewrites: web :3000 calls API :8787 directly, so local runs need CORS.
	corsOrigins: [process.env.WEB_ORIGIN ?? "http://localhost:3000"],
});
serve({ fetch: app.fetch, port }, () =>
	console.log(
		`API local: http://localhost:${port}/api (signed in as ${email})`,
	),
);
