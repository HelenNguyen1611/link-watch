import { Logger } from "@aws-lambda-powertools/logger";
import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { createDb } from "@linkwatch/core/db";
import { createHandler } from "./handler";
import { s3SnapshotStore } from "./snapshot-store";

const logger = new Logger({ serviceName: "dispatcher" });
const queueUrl = process.env.CHECK_QUEUE_URL;
if (!queueUrl) throw new Error("Missing CHECK_QUEUE_URL");
const snapshotBucket = process.env.SNAPSHOT_BUCKET;

/** Lambda entry: EventBridge Scheduler every 5 minutes. */
export const handler = createHandler({
	db: createDb(),
	sqs: new SQSClient({}),
	queueUrl,
	log: (message, extra) => logger.info(message, extra ?? {}),
	...(snapshotBucket && {
		snapshot: s3SnapshotStore(new S3Client({}), snapshotBucket),
	}),
});
