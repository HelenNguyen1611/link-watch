import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cdk from "aws-cdk-lib/core";
import type { Construct } from "constructs";
import { LinkWatchFunction } from "./lambda";

/**
 * TẠM THỜI (Mốc 1, bỏ ở Bước 37b khi có Cognito): SSM SecureString chứa khóa API.
 * CloudFormation không tạo được SecureString nên tạo tay (docs/RUNBOOK.md mục 2).
 */
export const API_KEY_PARAM = "/linkwatch/api-shared-secret";

export interface ApiStackProps extends cdk.StackProps {
	table: dynamodb.ITable;
}

/** SRS 3.5: một Lambda Hono sau API Gateway HTTP API; web gọi qua CloudFront /api/*. */
export class ApiStack extends cdk.Stack {
	/** Domain execute-api cho origin CloudFront, vd. abc123.execute-api.ap-southeast-1.amazonaws.com */
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
			description: "LinkWatch API (Mốc 1: khóa API tạm, chưa có Cognito)",
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
