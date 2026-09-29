import { Match, Template } from "aws-cdk-lib/assertions";
import * as cdk from "aws-cdk-lib/core";
import { beforeAll, describe, expect, it } from "vitest";
import { API_KEY_PARAM, ApiStack } from "../lib/api-stack";
import { config } from "../lib/config";
import { DataStack } from "../lib/data-stack";

describe("LinkWatch-Api", () => {
	let template: Template;

	beforeAll(() => {
		const app = new cdk.App({ context: { "aws:cdk:bundling-stacks": [] } });
		const env = { account: config.account, region: config.region };
		const data = new DataStack(app, "LinkWatch-Data", { env });
		template = Template.fromStack(
			new ApiStack(app, "LinkWatch-Api", { env, table: data.table }),
		);
	});

	it("SRS 3.5: 1 Lambda API (Hono) arm64, Node 22, ngoài VPC, log 14 ngày", () => {
		template.resourceCountIs("AWS::Lambda::Function", 1);
		template.hasResourceProperties("AWS::Lambda::Function", {
			Architectures: ["arm64"],
			Runtime: "nodejs22.x",
			Timeout: 15,
			VpcConfig: Match.absent(),
			Environment: {
				Variables: Match.objectLike({
					TABLE_NAME: Match.anyValue(),
					API_KEY_PARAM,
				}),
			},
		});
		template.hasResourceProperties("AWS::Logs::LogGroup", {
			RetentionInDays: 14,
		});
	});

	it("HTTP API: route /api và /api/{proxy+} → Lambda; chưa có authorizer (Mốc 1 dùng khóa tạm)", () => {
		template.resourceCountIs("AWS::ApiGatewayV2::Api", 1);
		template.hasResourceProperties("AWS::ApiGatewayV2::Api", {
			ProtocolType: "HTTP",
		});
		const routes = Object.values(
			template.findResources("AWS::ApiGatewayV2::Route"),
		).map(
			(r) =>
				(r as { Properties: { RouteKey: string; AuthorizationType?: string } })
					.Properties,
		);
		expect(routes.map((r) => r.RouteKey).sort()).toEqual([
			"ANY /api",
			"ANY /api/{proxy+}",
		]);
		template.resourceCountIs("AWS::ApiGatewayV2::Authorizer", 0);
		template.hasResourceProperties("AWS::ApiGatewayV2::Api", {
			CorsConfiguration: Match.absent(),
		});
	});

	it("giới hạn tốc độ để chặn lạm dụng làm tăng chi phí", () => {
		template.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
			StageName: "$default",
			AutoDeploy: true,
			DefaultRouteSettings: {
				ThrottlingRateLimit: 10,
				ThrottlingBurstLimit: 20,
			},
		});
	});

	it("NFR-07 (tạm): Lambda chỉ đọc đúng tham số SSM khóa API, không tạo tham số (SecureString tạo tay)", () => {
		expect(API_KEY_PARAM).toBe("/linkwatch/api-shared-secret");
		const policies = JSON.stringify(template.findResources("AWS::IAM::Policy"));
		expect(policies).toContain("ssm:GetParameter");
		expect(policies).toContain(":parameter/linkwatch/api-shared-secret");
		template.resourceCountIs("AWS::SSM::Parameter", 0);
	});
});
