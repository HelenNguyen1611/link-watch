import {
	cognitoInviteEmail,
	cognitoVerificationEmail,
} from "@linkwatch/emails/cognito";
import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import { HttpUserPoolAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cognito from "aws-cdk-lib/aws-cognito";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import type * as lambda from "aws-cdk-lib/aws-lambda";
import type * as s3 from "aws-cdk-lib/aws-s3";
import type * as sqs from "aws-cdk-lib/aws-sqs";
import * as cdk from "aws-cdk-lib/core";
import type { Construct } from "constructs";
import { config } from "./config";
import { LinkWatchFunction } from "./lambda";
import { grantSendEmail } from "./ses";

export interface ApiStackProps extends cdk.StackProps {
	table: dynamodb.ITable;
	/** FR-16: Check now jobs go to the Workers priority queue (step 21). */
	priorityQueue: sqs.IQueue;
	/** Step 19b: the API reads the links snapshot (read-only). */
	snapshotBucket: s3.IBucket;
}

/**
 * SRS 3.5: a single Hono Lambda behind an API Gateway HTTP API; the web app calls it via CloudFront /api/*.
 * Step 37b (FR-28, NFR-07): Cognito User Pool (admins create users, no self sign-up) and a JWT
 * authorizer on every route except /api/health and /api/public/* (email token links).
 */
export class ApiStack extends cdk.Stack {
	/** execute-api domain for the CloudFront origin, e.g. abc123.execute-api.ap-southeast-1.amazonaws.com */
	readonly apiDomainName: string;
	/** Written to /auth-config.json by the web stack (static export cannot know them at build time). */
	readonly userPoolId: string;
	readonly userPoolClientId: string;
	readonly apiFunction: lambda.IFunction;

	constructor(scope: Construct, id: string, props: ApiStackProps) {
		super(scope, id, props);

		const fn = new LinkWatchFunction(this, "ApiFunction", {
			entry: "services/api/src/lambda.ts",
			timeout: cdk.Duration.seconds(15),
			environment: {
				TABLE_NAME: props.table.tableName,
				SES_IDENTITY: config.sesIdentity,
				SENDER_EMAIL: config.senderEmail,
				DEFAULT_ADMIN_EMAIL: config.defaultAdminEmail,
				PRIORITY_QUEUE_URL: props.priorityQueue.queueUrl,
				SNAPSHOT_BUCKET: props.snapshotBucket.bucketName,
			},
		});
		this.apiFunction = fn;
		props.priorityQueue.grantSendMessages(fn);
		props.snapshotBucket.grantRead(fn, "links/*");
		props.table.grantReadWriteData(fn);
		// FR-26: test email from the Settings screen.
		grantSendEmail(fn);

		// FR-28 / FR-29: invitation and verification emails. Sent by Cognito's default sender until
		// the SES account leaves the sandbox (RUNBOOK §2a); only the content is ours.
		const TEMP_PASSWORD_DAYS = 7;
		const cognitoEmail = {
			appUrl: `https://${config.domainName}`,
			senderAddress: "no-reply@verificationemail.com",
		};
		const invite = cognitoInviteEmail({
			...cognitoEmail,
			validityDays: TEMP_PASSWORD_DAYS,
		});
		// FR-28: "Forgot password" code, same look as every other LinkWatch email.
		const verification = cognitoVerificationEmail(cognitoEmail);

		// FR-28 (MVP): email + password, a single Admin role; users are created by an admin (RUNBOOK).
		const userPool = new cognito.UserPool(this, "UserPool", {
			userPoolName: "linkwatch-users",
			selfSignUpEnabled: false,
			signInAliases: { email: true },
			signInCaseSensitive: false,
			autoVerify: { email: true },
			standardAttributes: { email: { required: true, mutable: true } },
			passwordPolicy: {
				minLength: 12,
				requireLowercase: true,
				requireUppercase: true,
				requireDigits: true,
				requireSymbols: false,
				tempPasswordValidity: cdk.Duration.days(TEMP_PASSWORD_DAYS),
			},
			userInvitation: { emailSubject: invite.subject, emailBody: invite.html },
			userVerification: {
				emailStyle: cognito.VerificationEmailStyle.CODE,
				emailSubject: verification.subject,
				emailBody: verification.html,
			},
			accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
			mfa: cognito.Mfa.OFF,
			// Users are real accounts: keep them if the stack is ever deleted.
			removalPolicy: cdk.RemovalPolicy.RETAIN,
			deletionProtection: true,
		});
		// SPA client: no secret, SRP only (no plain password flow).
		const client = userPool.addClient("WebClient", {
			userPoolClientName: "linkwatch-web",
			generateSecret: false,
			authFlows: { userSrp: true },
			preventUserExistenceErrors: true,
			idTokenValidity: cdk.Duration.hours(1),
			accessTokenValidity: cdk.Duration.hours(1),
			refreshTokenValidity: cdk.Duration.days(30),
			enableTokenRevocation: true,
		});
		// Step 40b: smoke test signs in server-side with AWS credentials (AdminInitiateAuth);
		// the web client stays SRP-only.
		const smokeClient = userPool.addClient("SmokeClient", {
			userPoolClientName: "linkwatch-smoke",
			generateSecret: false,
			authFlows: { adminUserPassword: true },
			preventUserExistenceErrors: true,
			idTokenValidity: cdk.Duration.hours(1),
		});
		// HLR-09 / FR-29: roles are Cognito groups (in the ID token as cognito:groups);
		// no group → viewer. The API manages users through the admin API on this pool only.
		const roles = [
			["admin", "Full access: users, email settings, default schedule"],
			["editor", "Links, domains, schedules, recipients; handles incidents"],
			["viewer", "Read only"],
		] as const;
		for (const [groupName, description] of roles)
			new cognito.CfnUserPoolGroup(this, `Group${groupName}`, {
				userPoolId: userPool.userPoolId,
				groupName,
				description,
			});
		userPool.grant(
			fn,
			"cognito-idp:ListUsers",
			"cognito-idp:ListUsersInGroup",
			"cognito-idp:AdminGetUser",
			"cognito-idp:AdminListGroupsForUser",
			"cognito-idp:AdminCreateUser",
			"cognito-idp:AdminAddUserToGroup",
			"cognito-idp:AdminRemoveUserFromGroup",
			"cognito-idp:AdminEnableUser",
			"cognito-idp:AdminDisableUser",
			"cognito-idp:AdminDeleteUser",
			"cognito-idp:AdminUserGlobalSignOut",
		);
		fn.addEnvironment("USER_POOL_ID", userPool.userPoolId);

		this.userPoolId = userPool.userPoolId;
		this.userPoolClientId = client.userPoolClientId;

		// The API expects the ID token (it carries `email`); its `aud` is the client id.
		const authorizer = new HttpUserPoolAuthorizer(
			"CognitoAuthorizer",
			userPool,
			{
				userPoolClients: [client, smokeClient],
			},
		);

		const httpApi = new apigw.HttpApi(this, "HttpApi", {
			description: "LinkWatch API (Cognito JWT authorizer)",
			createDefaultStage: false,
		});
		new apigw.HttpStage(this, "DefaultStage", {
			httpApi,
			stageName: "$default",
			autoDeploy: true,
			throttle: { rateLimit: 10, burstLimit: 20 },
		});
		const integration = new HttpLambdaIntegration("ApiIntegration", fn);
		httpApi.addRoutes({
			path: "/api",
			methods: [apigw.HttpMethod.ANY],
			integration,
			authorizer,
		});
		httpApi.addRoutes({
			path: "/api/{proxy+}",
			methods: [apigw.HttpMethod.ANY],
			integration,
			authorizer,
		});
		// Public: health check, and email token links (milestone 3). More specific routes win.
		httpApi.addRoutes({
			path: "/api/health",
			methods: [apigw.HttpMethod.GET],
			integration,
		});
		httpApi.addRoutes({
			path: "/api/public/{proxy+}",
			methods: [apigw.HttpMethod.ANY],
			integration,
		});

		this.apiDomainName = cdk.Fn.select(
			2,
			cdk.Fn.split("/", httpApi.apiEndpoint),
		);
		new cdk.CfnOutput(this, "ApiEndpoint", { value: httpApi.apiEndpoint });
		new cdk.CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
		new cdk.CfnOutput(this, "UserPoolClientId", {
			value: client.userPoolClientId,
		});
		new cdk.CfnOutput(this, "SmokeClientId", {
			value: smokeClient.userPoolClientId,
		});
	}
}
