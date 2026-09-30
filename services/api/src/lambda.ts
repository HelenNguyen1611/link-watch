import { Logger } from "@aws-lambda-powertools/logger";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { createDb } from "@linkwatch/core/db";
import { handle } from "hono/aws-lambda";
import { createApp } from "./app";

const logger = new Logger({ serviceName: "api" });

const env = (name: string) => {
	const value = process.env[name];
	if (!value) throw new Error(`Missing environment variable ${name}`);
	return value;
};

const sqs = new SQSClient({});
const priorityQueueUrl = env("PRIORITY_QUEUE_URL");

const app = createApp({
	db: createDb(),
	auth: { kind: "apiGateway" },
	// FR-16: no delay — the Checker picks the job up within seconds.
	sendPriorityJob: async (job) => {
		await sqs.send(
			new SendMessageCommand({
				QueueUrl: priorityQueueUrl,
				MessageBody: JSON.stringify(job),
			}),
		);
	},
	email: {
		// FR-25: sendEmail retries itself, so the SDK makes a single attempt.
		ses: new SESv2Client({ maxAttempts: 1 }),
		defaults: {
			sesIdentity: env("SES_IDENTITY"),
			senderEmail: env("SENDER_EMAIL"),
			...(process.env.DEFAULT_ADMIN_EMAIL && {
				defaultAdminEmail: process.env.DEFAULT_ADMIN_EMAIL,
			}),
		},
	},
	log: (message, extra) => logger.error(message, extra ?? {}),
});

/** Lambda entry: API Gateway HTTP API (Cognito JWT authorizer) → Hono. */
export const handler = handle(app);
