import { Match, Template } from "aws-cdk-lib/assertions";
import * as cdk from "aws-cdk-lib/core";
import { beforeAll, describe, expect, it } from "vitest";
import { ApiStack } from "../lib/api-stack";
import { config } from "../lib/config";
import { DataStack } from "../lib/data-stack";
import { WorkersStack } from "../lib/workers-stack";

describe("LinkWatch-Api", () => {
	let template: Template;

	beforeAll(() => {
		const app = new cdk.App({ context: { "aws:cdk:bundling-stacks": [] } });
		const env = { account: config.account, region: config.region };
		const data = new DataStack(app, "LinkWatch-Data", { env });
		const workers = new WorkersStack(app, "LinkWatch-Workers", {
			env,
			table: data.table,
			snapshotBucket: data.snapshotBucket,
		});
		template = Template.fromStack(
			new ApiStack(app, "LinkWatch-Api", {
				env,
				table: data.table,
				priorityQueue: workers.priorityQueue,
				snapshotBucket: data.snapshotBucket,
			}),
		);
	});

	it("SRS 3.5: one API Lambda (Hono), arm64, Node 22, outside a VPC, 14-day logs", () => {
		template.resourceCountIs("AWS::Lambda::Function", 1);
		template.hasResourceProperties("AWS::Lambda::Function", {
			Architectures: ["arm64"],
			Runtime: "nodejs22.x",
			Timeout: 15,
			VpcConfig: Match.absent(),
			Environment: {
				Variables: Match.objectLike({
					TABLE_NAME: Match.anyValue(),
					SES_IDENTITY: config.sesIdentity,
					SENDER_EMAIL: config.senderEmail,
					DEFAULT_ADMIN_EMAIL: config.defaultAdminEmail,
					PRIORITY_QUEUE_URL: Match.anyValue(),
					SNAPSHOT_BUCKET: Match.anyValue(),
				}),
			},
		});
		template.hasResourceProperties("AWS::Logs::LogGroup", {
			RetentionInDays: 14,
		});
	});

	it("NFR-07: /api and /api/{proxy+} require the Cognito JWT authorizer; /api/health and /api/public/* are public", () => {
		template.resourceCountIs("AWS::ApiGatewayV2::Api", 1);
		template.hasResourceProperties("AWS::ApiGatewayV2::Api", {
			ProtocolType: "HTTP",
			CorsConfiguration: Match.absent(),
		});
		const routes = Object.values(
			template.findResources("AWS::ApiGatewayV2::Route"),
		).map(
			(r) =>
				(r as { Properties: { RouteKey: string; AuthorizationType?: string } })
					.Properties,
		);
		const auth = Object.fromEntries(
			routes.map((r) => [r.RouteKey, r.AuthorizationType ?? "NONE"]),
		);
		expect(auth).toEqual({
			"ANY /api": "JWT",
			"ANY /api/{proxy+}": "JWT",
			"GET /api/health": "NONE",
			"ANY /api/public/{proxy+}": "NONE",
		});
		template.resourceCountIs("AWS::ApiGatewayV2::Authorizer", 1);
		template.hasResourceProperties("AWS::ApiGatewayV2::Authorizer", {
			AuthorizerType: "JWT",
			IdentitySource: ["$request.header.Authorization"],
			JwtConfiguration: {
				Audience: [Match.anyValue(), Match.anyValue()],
				Issuer: Match.anyValue(),
			},
		});
	});

	it("FR-28: User Pool without self sign-up, email sign-in, retained; SPA client with SRP and no secret", () => {
		template.hasResource("AWS::Cognito::UserPool", {
			DeletionPolicy: "Retain",
			Properties: Match.objectLike({
				AdminCreateUserConfig: Match.objectLike({
					AllowAdminCreateUserOnly: true,
				}),
				UsernameAttributes: ["email"],
				DeletionProtection: "ACTIVE",
				Policies: {
					PasswordPolicy: Match.objectLike({ MinimumLength: 12 }),
				},
			}),
		});
		template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
			ClientName: "linkwatch-web",
			GenerateSecret: false,
			ExplicitAuthFlows: ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"],
			PreventUserExistenceErrors: "ENABLED",
		});
		// Step 40b: server-side sign-in for the smoke test only (needs IAM credentials).
		template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
			ClientName: "linkwatch-smoke",
			GenerateSecret: false,
			ExplicitAuthFlows: [
				"ALLOW_ADMIN_USER_PASSWORD_AUTH",
				"ALLOW_REFRESH_TOKEN_AUTH",
			],
		});
		template.resourceCountIs("AWS::Cognito::UserPoolClient", 2);
	});

	it("throttles requests so abuse cannot drive up cost", () => {
		template.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
			StageName: "$default",
			AutoDeploy: true,
			DefaultRouteSettings: {
				ThrottlingRateLimit: 10,
				ThrottlingBurstLimit: 20,
			},
		});
	});

	it("step 19b: the API reads the snapshot objects only (no write)", () => {
		const policies = JSON.stringify(template.findResources("AWS::IAM::Policy"));
		expect(policies).toContain("s3:GetObject*");
		expect(policies).toContain("/links/*");
		expect(policies).not.toContain("s3:PutObject");
	});

	it("FR-16: the API may send Check now jobs to the priority queue (and nothing else on SQS)", () => {
		const policies = JSON.stringify(template.findResources("AWS::IAM::Policy"));
		expect(policies).toContain("sqs:SendMessage");
		expect(policies).not.toContain("sqs:ReceiveMessage");
		expect(policies).not.toContain("sqs:DeleteMessage");
	});

	it("NFR-07: the temporary API key is gone — no SSM access for the API Lambda", () => {
		const policies = JSON.stringify(template.findResources("AWS::IAM::Policy"));
		expect(policies).not.toContain("ssm:GetParameter");
		expect(policies).not.toContain("api-shared-secret");
		template.resourceCountIs("AWS::SSM::Parameter", 0);
	});
});
