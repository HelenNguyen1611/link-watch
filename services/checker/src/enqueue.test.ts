import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { enqueuePriority } from "./enqueue";

const sqsMock = mockClient(SQSClient);
beforeEach(() => sqsMock.reset());

describe("enqueuePriority — PLAN Q2", () => {
	it("5.2: sends the job to the priority queue with DelaySeconds", async () => {
		sqsMock.on(SendMessageCommand).resolves({ MessageId: "m1" });
		const job = {
			kind: "recheck" as const,
			domain: "abc.com",
			linkIds: ["L1"],
			dueAt: "2026-09-29T23:04:00.000Z",
		};
		await enqueuePriority(
			{ sqs: new SQSClient({}), queueUrl: "https://sqs/priority" },
			job,
			120,
		);
		const calls = sqsMock.commandCalls(SendMessageCommand);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.args[0].input).toEqual({
			QueueUrl: "https://sqs/priority",
			MessageBody: JSON.stringify(job),
			DelaySeconds: 120,
		});
	});
});
