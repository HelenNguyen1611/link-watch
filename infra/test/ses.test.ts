import { Match, Template } from "aws-cdk-lib/assertions";
import * as cdk from "aws-cdk-lib/core";
import { beforeAll, describe, expect, it } from "vitest";
import { ApiStack } from "../lib/api-stack";
import { config } from "../lib/config";
import { DataStack } from "../lib/data-stack";
import { WorkersStack } from "../lib/workers-stack";

describe("SES references (step 38b, FR-26)", () => {
	let stacks: Record<string, Template>;

	beforeAll(() => {
		const app = new cdk.App({ context: { "aws:cdk:bundling-stacks": [] } });
		const env = { account: config.account, region: config.region };
		const data = new DataStack(app, "LinkWatch-Data", { env });
		const workers = new WorkersStack(app, "LinkWatch-Workers", {
			env,
			table: data.table,
			snapshotBucket: data.snapshotBucket,
		});
		const api = new ApiStack(app, "LinkWatch-Api", {
			env,
			table: data.table,
			priorityQueue: workers.priorityQueue,
			snapshotBucket: data.snapshotBucket,
		});
		// Build every stack before the first synth (Template.fromStack synthesizes the app).
		stacks = {
			data: Template.fromStack(data),
			workers: Template.fromStack(workers),
			api: Template.fromStack(api),
		};
	});

	const sendStatement = Match.objectLike({
		Action: "ses:SendEmail",
		Effect: "Allow",
		Resource: `arn:aws:ses:${config.region}:${config.account}:identity/*`,
		Condition: {
			StringLike: {
				"ses:FromAddress": ["*@watch.hueai.net", "*@*.watch.hueai.net"],
			},
		},
	});

	it("FR-26: Alert may send only From the verified domain", () => {
		stacks.workers?.hasResourceProperties("AWS::IAM::Policy", {
			PolicyDocument: {
				Statement: Match.arrayWith([sendStatement]),
			},
		});
	});

	it("FR-26: API may send the test email only From the verified domain", () => {
		stacks.api?.hasResourceProperties("AWS::IAM::Policy", {
			PolicyDocument: {
				Statement: Match.arrayWith([sendStatement]),
			},
		});
	});

	it("FR-26: no stack creates SES or ACM resources (both are managed manually)", () => {
		for (const t of Object.values(stacks)) {
			const types = Object.values(t.toJSON().Resources ?? {}).map(
				(r) => (r as { Type: string }).Type,
			);
			expect(
				types.filter((x) => /^AWS::(SES|CertificateManager)::/.test(x)),
			).toEqual([]);
		}
	});

	it("FR-26: config holds the SES identity and the default sender", () => {
		expect(config.sesIdentity).toBe("watch.hueai.net");
		expect(config.senderEmail.endsWith(`@${config.sesIdentity}`)).toBe(true);
	});
});
