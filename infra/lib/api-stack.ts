import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import { HttpUserPoolAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cognito from "aws-cdk-lib/aws-cognito";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import type * as lambda from "aws-cdk-lib/aws-lambda";
import * as cdk from "aws-cdk-lib/core";
import type { Construct } from "constructs";
import { config } from "./config";
import { LinkWatchFunction } from "./lambda";

export interface ApiStackProps extends cdk.StackProps {
	table: dynamodb.ITable;
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
	/** Step 38b grants it ses:SendEmail on the existing identity (test email). */
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
			},
		});
		this.apiFunction = fn;
		props.table.grantReadWriteData(fn);

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
				tempPasswordValidity: cdk.Duration.days(7),
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
		this.userPoolId = userPool.userPoolId;
		this.userPoolClientId = client.userPoolClientId;

		// The API expects the ID token (it carries `email`); its `aud` is the client id.
		const authorizer = new HttpUserPoolAuthorizer(
			"CognitoAuthorizer",
			userPool,
			{
				userPoolClients: [client],
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
	}
}
