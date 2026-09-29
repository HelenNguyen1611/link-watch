import { Logger } from "@aws-lambda-powertools/logger";
import { SQSClient } from "@aws-sdk/client-sqs";
import { createDb } from "@linkwatch/core/db";
import { createHandler } from "./handler";

const logger = new Logger({ serviceName: "checker" });
const priorityQueueUrl = process.env.PRIORITY_QUEUE_URL;

/** Lambda entry: SQS FIFO (scheduled) + priority Standard queue (rechecks) → Checker. */
export const handler = createHandler({
	db: createDb(),
	log: (message, extra) => logger.info(message, extra ?? {}),
	...(priorityQueueUrl && {
		priorityQueue: { sqs: new SQSClient({}), queueUrl: priorityQueueUrl },
	}),
});
