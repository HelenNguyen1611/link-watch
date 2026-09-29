import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as eventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import * as targets from "aws-cdk-lib/aws-scheduler-targets";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as cdk from "aws-cdk-lib/core";
import type { Construct } from "constructs";
import { LinkWatchFunction } from "./lambda";

export interface WorkersStackProps extends cdk.StackProps {
	table: dynamodb.ITable;
}

/**
 * NFR-06: max concurrent Checker invocations, capped on the SQS event source (minimum 2).
 * The account concurrency quota is currently 10: leave room for the API, Dispatcher and
 * BucketDeployment, and do not use reserved concurrency (the deploy would fail). Once the
 * quota is ≥ 100: raise this number or consider reserved concurrency (docs/RUNBOOK.md §3).
 */
export const CHECKER_MAX_CONCURRENCY = 5;
/** 20 links/message, 2 concurrent per domain, up to 30 s + 5 s SSL read per link ≈ 350 s. */
const CHECKER_TIMEOUT = cdk.Duration.minutes(7);

/**
 * Milestone 1: EventBridge Scheduler every 5 min → Dispatcher → SQS FIFO → Checker → DynamoDB.
 * The priority queue and Alert are added in step 36b.
 */
export class WorkersStack extends cdk.Stack {
	readonly checkQueue: sqs.Queue;

	constructor(scope: Construct, id: string, props: WorkersStackProps) {
		super(scope, id, props);

		const dlq = new sqs.Queue(this, "CheckDlq", {
			fifo: true,
			retentionPeriod: cdk.Duration.days(14),
			enforceSSL: true,
		});
		this.checkQueue = new sqs.Queue(this, "CheckQueue", {
			fifo: true,
			// The Dispatcher sets MessageDeduplicationId itself.
			contentBasedDeduplication: false,
			visibilityTimeout: cdk.Duration.minutes(15),
			deadLetterQueue: { queue: dlq, maxReceiveCount: 3 },
			enforceSSL: true,
		});

		const dispatcher = new LinkWatchFunction(this, "Dispatcher", {
			entry: "services/dispatcher/src/index.ts",
			timeout: cdk.Duration.minutes(2),
			environment: {
				TABLE_NAME: props.table.tableName,
				CHECK_QUEUE_URL: this.checkQueue.queueUrl,
			},
		});
		props.table.grantReadWriteData(dispatcher);
		this.checkQueue.grantSendMessages(dispatcher);

		const checker = new LinkWatchFunction(this, "Checker", {
			entry: "services/checker/src/index.ts",
			timeout: CHECKER_TIMEOUT,
			environment: { TABLE_NAME: props.table.tableName },
		});
		props.table.grantReadWriteData(checker);
		checker.addEventSource(
			new eventSources.SqsEventSource(this.checkQueue, {
				batchSize: 1,
				reportBatchItemFailures: true,
				maxConcurrency: CHECKER_MAX_CONCURRENCY,
			}),
		);

		new scheduler.Schedule(this, "DispatchEvery5Min", {
			description:
				"LinkWatch: dispatch due links every 5 minutes (FR-11, NFR-04)",
			schedule: scheduler.ScheduleExpression.rate(cdk.Duration.minutes(5)),
			target: new targets.LambdaInvoke(dispatcher, { retryAttempts: 0 }),
		});

		new cdk.CfnOutput(this, "CheckDlqUrl", { value: dlq.queueUrl });
	}
}
