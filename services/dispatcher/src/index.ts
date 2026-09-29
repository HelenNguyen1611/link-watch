import { Logger } from "@aws-lambda-powertools/logger";
import { SQSClient } from "@aws-sdk/client-sqs";
import { createDb } from "@linkwatch/core/db";
import { createHandler } from "./handler";

const logger = new Logger({ serviceName: "dispatcher" });
const queueUrl = process.env.CHECK_QUEUE_URL;
if (!queueUrl) throw new Error("Missing CHECK_QUEUE_URL");

/** Lambda entry: EventBridge Scheduler every 5 minutes. */
export const handler = createHandler({
	db: createDb(),
	sqs: new SQSClient({}),
	queueUrl,
	log: (message, extra) => logger.info(message, extra ?? {}),
});
