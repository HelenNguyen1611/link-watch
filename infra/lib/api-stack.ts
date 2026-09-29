import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cdk from "aws-cdk-lib/core";
import type { Construct } from "constructs";
import { LinkWatchFunction } from "./lambda";

/**
 * TEMPORARY (milestone 1, removed in step 37b with Cognito): SSM SecureString holding the API key.
 * CloudFormation cannot create SecureStrings, so it is created manually (docs/RUNBOOK.md §2).
 */
export const API_KEY_PARAM = "/linkwatch/api-shared-secret";

export interface ApiStackProps extends cdk.StackProps {
	table: dynamodb.ITable;
}

/** SRS 3.5: a single Hono Lambda behind an API Gateway HTTP API; the web app calls it via CloudFront /api/*. */
export class ApiStack extends cdk.Stack {
	/** execute-api domain for the CloudFront origin, e.g. abc123.execute-api.ap-southeast-1.amazonaws.com */
	readonly apiDomainName: string;

	constructor(scope: Construct, id: string, props: ApiStackProps) {
		super(scope, id, props);

		const fn = new LinkWatchFunction(this, "ApiFunction", {
			entry: "services/api/src/lambda.ts",
			timeout: cdk.Duration.seconds(15),
			environment: { TABLE_NAME: props.table.tableName, API_KEY_PARAM },
		});
		props.table.grantReadWriteData(fn);
		fn.addToRolePolicy(
			new iam.PolicyStatement({
				actions: ["ssm:GetParameter"],
				resources: [
					`arn:aws:ssm:${this.region}:${this.account}:parameter${API_KEY_PARAM}`,
				],
			}),
		);

		const httpApi = new apigw.HttpApi(this, "HttpApi", {
			description:
				"LinkWatch API (milestone 1: temporary API key, no Cognito yet)",
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
		});
		httpApi.addRoutes({
			path: "/api/{proxy+}",
			methods: [apigw.HttpMethod.ANY],
			integration,
		});

		this.apiDomainName = cdk.Fn.select(
			2,
			cdk.Fn.split("/", httpApi.apiEndpoint),
		);
		new cdk.CfnOutput(this, "ApiEndpoint", { value: httpApi.apiEndpoint });
	}
}
