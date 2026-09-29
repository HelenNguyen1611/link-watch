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
	const fn = (name: "dispatcher" | "checker") =>
		Object.entries(fns).find(([id]) =>
			id.toLowerCase().startsWith(name),
		)?.[1] as Fn;

	beforeAll(() => {
		// Không đóng gói Lambda trong test (nhanh); pnpm synth vẫn đóng gói thật.
		const app = new cdk.App({ context: { "aws:cdk:bundling-stacks": [] } });
		const env = { account: config.account, region: config.region };
		const data = new DataStack(app, "LinkWatch-Data", { env });
		const workers = new WorkersStack(app, "LinkWatch-Workers", {
			env,
			table: data.table,
		});
		template = Template.fromStack(workers);
		fns = template.findResources("AWS::Lambda::Function") as Record<string, Fn>;
	});

	it("2 Lambda Dispatcher + Checker: arm64, Node 22, ngoài VPC (SRS 3.4)", () => {
		expect(Object.keys(fns)).toHaveLength(2);
		for (const f of Object.values(fns)) {
			expect(f.Properties.Architectures).toEqual(["arm64"]);
			expect(f.Properties.Runtime).toBe("nodejs22.x");
			expect(f.Properties).not.toHaveProperty("VpcConfig");
		}
		template.resourceCountIs("AWS::EC2::NatGateway", 0);
		template.resourceCountIs("AWS::EC2::VPC", 0);
	});

	it("log giữ 14 ngày cho cả 2 hàm", () => {
		template.resourceCountIs("AWS::Logs::LogGroup", 2);
		template.allResourcesProperties("AWS::Logs::LogGroup", {
			RetentionInDays: 14,
		});
	});

	it("NFR-06: Checker giới hạn 5 lần gọi đồng thời trên event source SQS, timeout đủ cho 20 link", () => {
		template.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
			ScalingConfig: { MaximumConcurrency: 5 },
		});
		expect(fn("checker").Properties.Timeout).toBe(420);
	});

	it("không dùng reserved concurrency (không phụ thuộc hạn mức concurrency của tài khoản)", () => {
		for (const f of Object.values(fns)) {
			expect(f.Properties).not.toHaveProperty("ReservedConcurrentExecutions");
		}
	});

	it("SRS 3.4: SQS FIFO (MessageGroupId = domain, dedup id do Dispatcher đặt)", () => {
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

	it("NFR-04: job lỗi 3 lần vào DLQ FIFO, giữ 14 ngày", () => {
		const queues = Object.values(template.findResources("AWS::SQS::Queue"));
		expect(queues).toHaveLength(2);
		const dlq = queues.find((q) => !(q as Fn).Properties.RedrivePolicy) as Fn;
		expect(dlq.Properties).toMatchObject({
			FifoQueue: true,
			MessageRetentionPeriod: 14 * 86400,
		});
	});

	it("Checker nhận 1 message/lần, báo lỗi từng message (batchItemFailures)", () => {
		template.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
			BatchSize: 1,
			FunctionResponseTypes: ["ReportBatchItemFailures"],
		});
	});

	it("FR-11 / NFR-04: EventBridge Scheduler gọi Dispatcher mỗi 5 phút", () => {
		template.hasResourceProperties("AWS::Scheduler::Schedule", {
			ScheduleExpression: "rate(5 minutes)",
			State: "ENABLED",
			FlexibleTimeWindow: { Mode: "OFF" },
		});
	});

	it("biến môi trường: TABLE_NAME cho cả 2, CHECK_QUEUE_URL cho Dispatcher", () => {
		const envOf = (f: Fn) =>
			(f.Properties.Environment as { Variables: Record<string, unknown> })
				.Variables;
		expect(Object.keys(envOf(fn("dispatcher")))).toEqual(
			expect.arrayContaining(["TABLE_NAME", "CHECK_QUEUE_URL"]),
		);
		expect(Object.keys(envOf(fn("checker")))).toContain("TABLE_NAME");
		expect(Object.keys(envOf(fn("checker")))).not.toContain("CHECK_QUEUE_URL");
	});

	it("IAM tối thiểu: Dispatcher gửi được vào hàng đợi; không ai có quyền xóa bảng", () => {
		const policies = JSON.stringify(template.findResources("AWS::IAM::Policy"));
		expect(policies).toContain("sqs:SendMessage");
		expect(policies).not.toContain("dynamodb:DeleteTable");
		expect(policies).not.toContain('"Action":"*"');
	});
});
