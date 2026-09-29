import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import type { PriorityJob } from "@linkwatch/core";

export type PriorityQueue = { sqs: SQSClient; queueUrl: string };

/**
 * PLAN Q2: sends one job to the priority Standard queue with a per-message delay
 * (FIFO queues do not support per-message DelaySeconds).
 */
export async function enqueuePriority(
	queue: PriorityQueue,
	job: PriorityJob,
	delaySeconds: number,
): Promise<void> {
	await queue.sqs.send(
		new SendMessageCommand({
			QueueUrl: queue.queueUrl,
			MessageBody: JSON.stringify(job),
			DelaySeconds: delaySeconds,
		}),
	);
}
