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

/** NFR-06: tăng thông lượng bằng cách nâng số này, không sửa code. */
export const CHECKER_RESERVED_CONCURRENCY = 10;
/** 20 link/message, 2 đồng thời/domain, tối đa 30 s + 5 s đọc SSL mỗi link ≈ 350 s. */
const CHECKER_TIMEOUT = cdk.Duration.minutes(7);

/**
 * Mốc 1: EventBridge Scheduler 5 phút → Dispatcher → SQS FIFO → Checker → DynamoDB.
 * Hàng đợi ưu tiên và Alert thêm ở Bước 36b.
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
			// Dispatcher tự đặt MessageDeduplicationId.
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
			reservedConcurrentExecutions: CHECKER_RESERVED_CONCURRENCY,
			environment: { TABLE_NAME: props.table.tableName },
		});
		props.table.grantReadWriteData(checker);
		checker.addEventSource(
			new eventSources.SqsEventSource(this.checkQueue, {
				batchSize: 1,
				reportBatchItemFailures: true,
			}),
		);

		new scheduler.Schedule(this, "DispatchEvery5Min", {
			description: "LinkWatch: lấy link đến hạn mỗi 5 phút (FR-11, NFR-04)",
			schedule: scheduler.ScheduleExpression.rate(cdk.Duration.minutes(5)),
			target: new targets.LambdaInvoke(dispatcher, { retryAttempts: 0 }),
		});

		new cdk.CfnOutput(this, "CheckDlqUrl", { value: dlq.queueUrl });
	}
}
