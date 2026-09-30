import { Match, Template } from "aws-cdk-lib/assertions";
import * as cdk from "aws-cdk-lib/core";
import { beforeAll, describe, expect, it } from "vitest";
import { config } from "../lib/config";
import { DataStack } from "../lib/data-stack";
import { WorkersStack } from "../lib/workers-stack";

type Fn = { Properties: Record<string, unknown> };

describe("LinkWatch-Workers", () => {
	let template: Template;
	let fns: Record<string, Fn>;
	const fn = (name: "dispatcher" | "checker" | "alert") =>
		Object.entries(fns).find(([id]) =>
			id.toLowerCase().startsWith(name),
		)?.[1] as Fn;

	beforeAll(() => {
		// Skip Lambda bundling in tests (fast); pnpm synth still bundles for real.
		const app = new cdk.App({ context: { "aws:cdk:bundling-stacks": [] } });
		const env = { account: config.account, region: config.region };
		const data = new DataStack(app, "LinkWatch-Data", { env });
		const workers = new WorkersStack(app, "LinkWatch-Workers", {
			env,
			table: data.table,
			snapshotBucket: data.snapshotBucket,
		});
		template = Template.fromStack(workers);
		fns = template.findResources("AWS::Lambda::Function") as Record<string, Fn>;
	});

	it("3 Lambdas, Dispatcher + Checker + Alert: arm64, Node 22, outside a VPC (SRS 3.4)", () => {
		expect(Object.keys(fns)).toHaveLength(3);
		for (const f of Object.values(fns)) {
			expect(f.Properties.Architectures).toEqual(["arm64"]);
			expect(f.Properties.Runtime).toBe("nodejs22.x");
			expect(f.Properties).not.toHaveProperty("VpcConfig");
		}
		template.resourceCountIs("AWS::EC2::NatGateway", 0);
		template.resourceCountIs("AWS::EC2::VPC", 0);
	});

	it("every function keeps logs for 14 days", () => {
		template.resourceCountIs("AWS::Logs::LogGroup", 3);
		template.allResourcesProperties("AWS::Logs::LogGroup", {
			RetentionInDays: 14,
		});
	});

	it("NFR-06: Checker is capped at 5 concurrent invocations on the SQS event source, timeout fits 20 links", () => {
		template.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
			ScalingConfig: { MaximumConcurrency: 5 },
		});
		expect(fn("checker").Properties.Timeout).toBe(420);
	});

	it("uses no reserved concurrency (independent of the account concurrency quota)", () => {
		for (const f of Object.values(fns)) {
			expect(f.Properties).not.toHaveProperty("ReservedConcurrentExecutions");
		}
	});

	it("SRS 3.4: SQS FIFO (MessageGroupId = domain, dedup id set by the Dispatcher)", () => {
		template.hasResourceProperties("AWS::SQS::Queue", {
			FifoQueue: true,
			VisibilityTimeout: 900,
			RedrivePolicy: {
				maxReceiveCount: 3,
				deadLetterTargetArn: Match.anyValue(),
			},
			ContentBasedDeduplication: false,
		});
	});

	it("NFR-04: every queue sends messages failing 3 times to a DLQ kept for 14 days (FIFO for the check queue)", () => {
		const queues = template.findResources("AWS::SQS::Queue") as Record<
			string,
			Fn
		>;
		expect(Object.keys(queues).sort()).toEqual(
			expect.arrayContaining([
				expect.stringMatching(/^CheckQueue/),
				expect.stringMatching(/^CheckDlq/),
				expect.stringMatching(/^PriorityQueue/),
				expect.stringMatching(/^PriorityDlq/),
				expect.stringMatching(/^AlertQueue/),
				expect.stringMatching(/^AlertDlq/),
			]),
		);
		expect(Object.keys(queues)).toHaveLength(6);
		const dlqs = Object.entries(queues).filter(([id]) => /Dlq/.test(id));
		for (const [id, q] of dlqs) {
			expect(q.Properties.MessageRetentionPeriod).toBe(14 * 86400);
			expect(Boolean(q.Properties.FifoQueue)).toBe(id.startsWith("CheckDlq"));
		}
		for (const [id, q] of Object.entries(queues).filter(
			([i]) => !/Dlq/.test(i),
		))
			expect(q.Properties.RedrivePolicy, id).toMatchObject({
				maxReceiveCount: 3,
			});
	});

	it("PLAN Q2: priority Standard queue (per-message delay) feeds the Checker, which can also send to it", () => {
		const queues = template.findResources("AWS::SQS::Queue") as Record<
			string,
			Fn
		>;
		const [, priority] = Object.entries(queues).find(([id]) =>
			id.startsWith("PriorityQueue"),
		) as [string, Fn];
		expect(priority.Properties).not.toHaveProperty("FifoQueue");
		expect(priority.Properties.VisibilityTimeout).toBe(900);
		template.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
			BatchSize: 5,
			ScalingConfig: { MaximumConcurrency: 2 },
			FunctionResponseTypes: ["ReportBatchItemFailures"],
		});
		const env = (
			fn("checker").Properties.Environment as {
				Variables: Record<string, unknown>;
			}
		).Variables;
		expect(env).toHaveProperty("PRIORITY_QUEUE_URL");
	});

	it("FR-21 / PLAN Q3: Alert reads DynamoDB Streams filtered to incident items, with a DLQ", () => {
		template.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
			StartingPosition: "LATEST",
			FunctionResponseTypes: ["ReportBatchItemFailures"],
			BisectBatchOnFunctionError: true,
			MaximumRetryAttempts: 5,
			DestinationConfig: { OnFailure: { Destination: Match.anyValue() } },
			FilterCriteria: {
				Filters: [
					{
						Pattern: JSON.stringify({
							eventName: ["INSERT", "MODIFY"],
							dynamodb: { NewImage: { __edb_e__: { S: ["incident"] } } },
						}),
					},
				],
			},
		});
	});

	it("FR-20 / FR-26: Alert environment comes from config (SES identity, sender, admin, app URL)", () => {
		const env = (
			fn("alert").Properties.Environment as {
				Variables: Record<string, unknown>;
			}
		).Variables;
		expect(env).toMatchObject({
			APP_URL: `https://${config.domainName}`,
			SES_IDENTITY: config.sesIdentity,
			SENDER_EMAIL: "noreply@watch.hueai.net",
			DEFAULT_ADMIN_EMAIL: config.defaultAdminEmail,
		});
		expect(Object.keys(env)).toEqual(
			expect.arrayContaining(["TABLE_NAME", "ALERT_QUEUE_URL"]),
		);
	});

	it("FR-23: EventBridge Scheduler runs reminders every 15 minutes", () => {
		template.hasResourceProperties("AWS::Scheduler::Schedule", {
			ScheduleExpression: "rate(15 minutes)",
			Target: Match.objectLike({
				Input: JSON.stringify({ kind: "reminders" }),
			}),
		});
	});

	it("Checker takes 1 FIFO message per invocation and reports per-message failures (batchItemFailures)", () => {
		template.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
			BatchSize: 1,
			FunctionResponseTypes: ["ReportBatchItemFailures"],
			ScalingConfig: { MaximumConcurrency: 5 },
		});
	});

	it("FR-11 / NFR-04: EventBridge Scheduler invokes the Dispatcher every 5 minutes", () => {
		template.hasResourceProperties("AWS::Scheduler::Schedule", {
			ScheduleExpression: "rate(5 minutes)",
			State: "ENABLED",
			FlexibleTimeWindow: { Mode: "OFF" },
		});
	});

	it("environment: TABLE_NAME for both, CHECK_QUEUE_URL for the Dispatcher", () => {
		const envOf = (f: Fn) =>
			(f.Properties.Environment as { Variables: Record<string, unknown> })
				.Variables;
		expect(Object.keys(envOf(fn("dispatcher")))).toEqual(
			expect.arrayContaining(["TABLE_NAME", "CHECK_QUEUE_URL"]),
		);
		expect(Object.keys(envOf(fn("checker")))).toContain("TABLE_NAME");
		expect(Object.keys(envOf(fn("checker")))).not.toContain("CHECK_QUEUE_URL");
	});

	it("step 19b: the Dispatcher may only write the snapshot objects (links/*) and knows the bucket", () => {
		const env = (
			fn("dispatcher").Properties.Environment as {
				Variables: Record<string, unknown>;
			}
		).Variables;
		expect(env).toHaveProperty("SNAPSHOT_BUCKET");
		const policies = JSON.stringify(template.findResources("AWS::IAM::Policy"));
		expect(policies).toContain("s3:PutObject");
		expect(policies).toContain("/links/*");
		expect(policies).not.toContain("s3:DeleteObject");
	});

	it("least-privilege IAM: the Dispatcher can send to the queue; nobody can delete the table", () => {
		const policies = JSON.stringify(template.findResources("AWS::IAM::Policy"));
		expect(policies).toContain("sqs:SendMessage");
		expect(policies).not.toContain("dynamodb:DeleteTable");
		expect(policies).not.toContain('"Action":"*"');
	});
});
