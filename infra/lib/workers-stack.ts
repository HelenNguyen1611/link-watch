import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as eventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import * as targets from "aws-cdk-lib/aws-scheduler-targets";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as cdk from "aws-cdk-lib/core";
import type { Construct } from "constructs";
import { config } from "./config";
import { LinkWatchFunction } from "./lambda";
import { grantSendEmail } from "./ses";

export interface WorkersStackProps extends cdk.StackProps {
	/** Needs the table stream (NEW_AND_OLD_IMAGES) for the Alert Lambda. */
	table: dynamodb.ITable;
}

/**
 * NFR-06: max concurrent Checker invocations, capped on the SQS event source (minimum 2).
 * The account concurrency quota is currently 10: leave room for the API, Dispatcher and
 * BucketDeployment, and do not use reserved concurrency (the deploy would fail). Once the
 * quota is ≥ 100: raise this number or consider reserved concurrency (docs/RUNBOOK.md §3).
 */
export const CHECKER_MAX_CONCURRENCY = 5;
/** NFR-06: rechecks (priority queue) and alert flushes each get at most 2 concurrent invocations (SQS minimum). */
export const PRIORITY_MAX_CONCURRENCY = 2;
export const ALERT_MAX_CONCURRENCY = 2;
/** FR-23: how often the Alert Lambda looks for due reminders. */
export const REMINDER_RATE = cdk.Duration.minutes(15);
/** 20 links/message, 2 concurrent per domain, up to 30 s + 5 s SSL read per link ≈ 350 s. */
const CHECKER_TIMEOUT = cdk.Duration.minutes(7);

/**
 * EventBridge Scheduler every 5 min → Dispatcher → SQS FIFO → Checker → DynamoDB.
 * Step 36b: priority Standard queue for delayed rechecks (PLAN Q2), Alert Lambda fed by
 * DynamoDB Streams (incidents only) and its own delayed alert queue (PLAN Q3), reminders every 15 min (FR-23).
 */
export class WorkersStack extends cdk.Stack {
	readonly checkQueue: sqs.Queue;
	readonly alertFunction: lambda.IFunction;

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

		// PLAN Q2: Standard queue so each recheck can carry its own DelaySeconds.
		const priorityDlq = new sqs.Queue(this, "PriorityDlq", {
			retentionPeriod: cdk.Duration.days(14),
			enforceSSL: true,
		});
		const priorityQueue = new sqs.Queue(this, "PriorityQueue", {
			visibilityTimeout: cdk.Duration.minutes(15),
			deadLetterQueue: { queue: priorityDlq, maxReceiveCount: 3 },
			enforceSSL: true,
		});

		const checker = new LinkWatchFunction(this, "Checker", {
			entry: "services/checker/src/index.ts",
			timeout: CHECKER_TIMEOUT,
			environment: {
				TABLE_NAME: props.table.tableName,
				PRIORITY_QUEUE_URL: priorityQueue.queueUrl,
			},
		});
		props.table.grantReadWriteData(checker);
		checker.addEventSource(
			new eventSources.SqsEventSource(this.checkQueue, {
				batchSize: 1,
				reportBatchItemFailures: true,
				maxConcurrency: CHECKER_MAX_CONCURRENCY,
			}),
		);
		priorityQueue.grantSendMessages(checker);
		checker.addEventSource(
			new eventSources.SqsEventSource(priorityQueue, {
				batchSize: 5,
				reportBatchItemFailures: true,
				maxConcurrency: PRIORITY_MAX_CONCURRENCY,
			}),
		);

		new scheduler.Schedule(this, "DispatchEvery5Min", {
			description:
				"LinkWatch: dispatch due links every 5 minutes (FR-11, NFR-04)",
			schedule: scheduler.ScheduleExpression.rate(cdk.Duration.minutes(5)),
			target: new targets.LambdaInvoke(dispatcher, { retryAttempts: 0 }),
		});

		// PLAN Q3: delayed "flush" messages, 5 minutes after the first incident of a domain.
		const alertDlq = new sqs.Queue(this, "AlertDlq", {
			retentionPeriod: cdk.Duration.days(14),
			enforceSSL: true,
		});
		const alertQueue = new sqs.Queue(this, "AlertQueue", {
			visibilityTimeout: cdk.Duration.minutes(5),
			deadLetterQueue: { queue: alertDlq, maxReceiveCount: 3 },
			enforceSSL: true,
		});

		const alert = new LinkWatchFunction(this, "Alert", {
			entry: "services/alert/src/index.ts",
			timeout: cdk.Duration.minutes(2),
			environment: {
				TABLE_NAME: props.table.tableName,
				ALERT_QUEUE_URL: alertQueue.queueUrl,
				APP_URL: `https://${config.domainName}`,
				SES_IDENTITY: config.sesIdentity,
				SENDER_EMAIL: config.senderEmail,
				DEFAULT_ADMIN_EMAIL: config.defaultAdminEmail,
			},
		});
		this.alertFunction = alert;
		props.table.grantReadWriteData(alert);
		alertQueue.grantSendMessages(alert);
		grantSendEmail(alert);
		// Only incident items reach the Lambda (ElectroDB entity attribute): other writes cost nothing.
		alert.addEventSource(
			new eventSources.DynamoEventSource(props.table, {
				startingPosition: lambda.StartingPosition.LATEST,
				batchSize: 25,
				maxBatchingWindow: cdk.Duration.seconds(5),
				retryAttempts: 5,
				bisectBatchOnError: true,
				reportBatchItemFailures: true,
				onFailure: new eventSources.SqsDlq(alertDlq),
				filters: [
					lambda.FilterCriteria.filter({
						eventName: lambda.FilterRule.or("INSERT", "MODIFY"),
						dynamodb: {
							NewImage: {
								__edb_e__: { S: lambda.FilterRule.isEqual("incident") },
							},
						},
					}),
				],
			}),
		);
		alert.addEventSource(
			new eventSources.SqsEventSource(alertQueue, {
				batchSize: 5,
				reportBatchItemFailures: true,
				maxConcurrency: ALERT_MAX_CONCURRENCY,
			}),
		);
		new scheduler.Schedule(this, "RemindersEvery15Min", {
			description:
				"LinkWatch: reminders for open unacknowledged incidents (FR-23)",
			schedule: scheduler.ScheduleExpression.rate(REMINDER_RATE),
			target: new targets.LambdaInvoke(alert, {
				retryAttempts: 0,
				input: scheduler.ScheduleTargetInput.fromObject({ kind: "reminders" }),
			}),
		});

		new cdk.CfnOutput(this, "CheckDlqUrl", { value: dlq.queueUrl });
		new cdk.CfnOutput(this, "PriorityDlqUrl", { value: priorityDlq.queueUrl });
		new cdk.CfnOutput(this, "AlertDlqUrl", { value: alertDlq.queueUrl });
	}
}
