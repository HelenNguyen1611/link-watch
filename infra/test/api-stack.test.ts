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

	it("HLR-09: admin, editor and viewer Cognito groups on the existing User Pool", () => {
		template.resourceCountIs("AWS::Cognito::UserPoolGroup", 3);
		for (const GroupName of ["admin", "editor", "viewer"])
			template.hasResourceProperties("AWS::Cognito::UserPoolGroup", {
				GroupName,
				UserPoolId: { Ref: Match.stringLikeRegexp("^UserPool") },
			});
		// The pool keeps its logical ID (real accounts live in it).
		expect(
			Object.keys(template.findResources("AWS::Cognito::UserPool")),
		).toEqual([expect.stringMatching(/^UserPool[0-9A-F]{8}$/)]);
	});

	it("FR-29: the API manages users of this pool only, and knows its id", () => {
		const statements = Object.values(
			template.findResources("AWS::IAM::Policy"),
		).flatMap(
			(p) =>
				(p as { Properties: { PolicyDocument: { Statement: unknown[] } } })
					.Properties.PolicyDocument.Statement,
		) as { Action: string | string[]; Resource: unknown }[];
		const cognitoStatements = statements.filter((s) =>
			[s.Action].flat().some((a) => a.startsWith("cognito-idp:")),
		);
		expect(cognitoStatements).toHaveLength(1);
		const [statement] = cognitoStatements;
		expect([statement?.Action].flat()).toEqual(
			expect.arrayContaining([
				"cognito-idp:ListUsers",
				"cognito-idp:AdminCreateUser",
				"cognito-idp:AdminAddUserToGroup",
				"cognito-idp:AdminDisableUser",
				"cognito-idp:AdminDeleteUser",
				"cognito-idp:AdminUserGlobalSignOut",
			]),
		);
		expect(statement?.Resource).toEqual({
			"Fn::GetAtt": [expect.stringMatching(/^UserPool/), "Arn"],
		});
		template.hasResourceProperties("AWS::Lambda::Function", {
			Environment: {
				Variables: Match.objectLike({
					USER_POOL_ID: { Ref: Match.stringLikeRegexp("^UserPool") },
				}),
			},
		});
	});

	it("FR-29: invitation email from packages/emails, with Cognito's placeholders and a 7-day password", () => {
		const pool = Object.values(
			template.findResources("AWS::Cognito::UserPool"),
		)[0] as {
			Properties: {
				AdminCreateUserConfig: {
					InviteMessageTemplate: { EmailSubject: string; EmailMessage: string };
				};
				Policies: { PasswordPolicy: { TemporaryPasswordValidityDays: number } };
			};
		};
		const invite = pool.Properties.AdminCreateUserConfig.InviteMessageTemplate;
		expect(invite.EmailSubject).toBe(
			"Your LinkWatch invitation and temporary password",
		);
		expect(invite.EmailMessage).toContain("{username}");
		expect(invite.EmailMessage).toContain("{####}");
		expect(invite.EmailMessage).toContain("https://watch.hueai.net/login/");
		expect(invite.EmailMessage).toContain("expires in 7 days");
		expect(
			pool.Properties.Policies.PasswordPolicy.TemporaryPasswordValidityDays,
		).toBe(7);
	});

	it("FR-28: Forgot password code email from packages/emails (code style)", () => {
		template.hasResourceProperties("AWS::Cognito::UserPool", {
			VerificationMessageTemplate: Match.objectLike({
				DefaultEmailOption: "CONFIRM_WITH_CODE",
				EmailSubject: "Your LinkWatch verification code",
				EmailMessage: Match.stringLikeRegexp("\\{####\\}.*1 hour"),
			}),
		});
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
