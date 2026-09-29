import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import { AlertJob, MAX_DELAY_SECONDS } from "@linkwatch/core";
import { addToOutbox } from "@linkwatch/core/usecases";
import type {
	DynamoDBBatchResponse,
	DynamoDBStreamEvent,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import { type AlertDeps, flushOutbox } from "./outbox";
import { sendReminders } from "./reminder";
import { toNotificationEvent } from "./stream";

export type AlertHandlerDeps = AlertDeps & {
	sqs: SQSClient;
	/** PLAN Q3: Standard queue receiving the delayed flush messages. */
	alertQueueUrl: string;
	now?: () => Date;
};

/** FR-23: payload of the EventBridge Scheduler rule that runs reminders (step 36b). */
export type ReminderEvent = { kind: "reminders" };

type AlertEvent = DynamoDBStreamEvent | SQSEvent | ReminderEvent;

const isReminder = (event: AlertEvent): event is ReminderEvent =>
	(event as ReminderEvent).kind === "reminders";

const isStream = (
	event: DynamoDBStreamEvent | SQSEvent,
): event is DynamoDBStreamEvent =>
	event.Records[0]?.eventSource === "aws:dynamodb";

/**
 * Alert Lambda: DynamoDB Streams (incident opened/closed) → outbox + delayed flush;
 * alert queue (flush) → grouped email through SES; scheduler → reminders (FR-23).
 */
export function createHandler(deps: AlertHandlerDeps) {
	const now = deps.now ?? (() => new Date());
	const log = deps.log ?? (() => {});

	async function onStream(
		event: DynamoDBStreamEvent,
	): Promise<DynamoDBBatchResponse> {
		// Streams are ordered: stop at the first failure and retry from there.
		for (const record of event.Records) {
			try {
				const ev = toNotificationEvent(record);
				if (!ev) continue;
				const { flushAt } = await addToOutbox(deps.db, ev);
				if (!flushAt) continue;
				const delay = Math.ceil((Date.parse(flushAt) - now().getTime()) / 1000);
				const job: AlertJob = {
					kind: "flush",
					domain: ev.domain,
					notification: ev.kind,
				};
				try {
					await deps.sqs.send(
						new SendMessageCommand({
							QueueUrl: deps.alertQueueUrl,
							MessageBody: JSON.stringify(job),
							DelaySeconds: Math.min(MAX_DELAY_SECONDS, Math.max(0, delay)),
						}),
					);
				} catch (err) {
					// Without its flush the window would never close: reopen it on the retry.
					await deps.db.OutboxWindow.delete({
						domain: ev.domain,
						kind: ev.kind,
					}).go();
					throw err;
				}
			} catch (err) {
				log("Stream record failed", { error: String(err) });
				return {
					batchItemFailures: [
						{ itemIdentifier: record.dynamodb?.SequenceNumber ?? "" },
					],
				};
			}
		}
		return { batchItemFailures: [] };
	}

	async function onQueue(event: SQSEvent): Promise<SQSBatchResponse> {
		const failures: SQSBatchResponse["batchItemFailures"] = [];
		for (const record of event.Records) {
			try {
				const job = AlertJob.parse(JSON.parse(record.body));
				await flushOutbox(
					deps,
					{ domain: job.domain, kind: job.notification },
					now(),
				);
			} catch (err) {
				log("Flush failed", {
					messageId: record.messageId,
					error: String(err),
				});
				failures.push({ itemIdentifier: record.messageId });
			}
		}
		return { batchItemFailures: failures };
	}

	async function handler(event: ReminderEvent): Promise<{ reminded: number }>;
	async function handler(
		event: DynamoDBStreamEvent | SQSEvent,
	): Promise<DynamoDBBatchResponse | SQSBatchResponse>;
	async function handler(event: AlertEvent) {
		if (isReminder(event)) {
			const reminded = await sendReminders(deps, now());
			log("Reminders sent", { incidents: reminded });
			return { reminded };
		}
		if (event.Records.length === 0) return { batchItemFailures: [] };
		return isStream(event) ? onStream(event) : onQueue(event);
	}
	return handler;
}
