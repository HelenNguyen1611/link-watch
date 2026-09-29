import { Logger } from "@aws-lambda-powertools/logger";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import { SQSClient } from "@aws-sdk/client-sqs";
import { createDb } from "@linkwatch/core/db";
import { createHandler } from "./handler";

const logger = new Logger({ serviceName: "alert" });

const env = (name: string) => {
	const value = process.env[name];
	if (!value) throw new Error(`Missing environment variable ${name}`);
	return value;
};

/** Lambda entry: DynamoDB Streams + alert queue → SES (FR-20 → FR-25). */
export const handler = createHandler({
	db: createDb(),
	// FR-25: the app retries 3 times itself, so the SDK makes a single attempt.
	ses: new SESv2Client({ maxAttempts: 1 }),
	sqs: new SQSClient({}),
	alertQueueUrl: env("ALERT_QUEUE_URL"),
	config: {
		appUrl: env("APP_URL"),
		defaults: {
			sesIdentity: env("SES_IDENTITY"),
			senderEmail: env("SENDER_EMAIL"),
			...(process.env.DEFAULT_ADMIN_EMAIL && {
				defaultAdminEmail: process.env.DEFAULT_ADMIN_EMAIL,
			}),
		},
	},
	log: (message, extra) => logger.info(message, extra ?? {}),
});
