import * as path from "node:path";
import { Match, Template } from "aws-cdk-lib/assertions";
import * as cdk from "aws-cdk-lib/core";
import { beforeAll, describe, expect, it } from "vitest";
import { config } from "../lib/config";
import { WebStack } from "../lib/web-stack";

// Stack đang chạy thật: logical ID đổi = CloudFormation xóa và tạo lại tài nguyên.
const DEPLOYED_LOGICAL_IDS = [
	"SiteBucket397A1860",
	"SiteBucketPolicy3AC1D0F8",
	"IndexRewrite0A63A7CD",
	"DistributionOrigin1S3OriginAccessControlEB606076",
	"Distribution830FAC52",
	"DeploySiteCustomResource512MiB5775DB62",
];

describe("LinkWatch-Web", () => {
	let template: Template;

	beforeAll(() => {
		const app = new cdk.App();
		const stack = new WebStack(app, "LinkWatch-Web", {
			env: { account: config.account, region: config.region },
			siteDir: path.join(__dirname, "fixtures/site"),
		});
		template = Template.fromStack(stack);
	});

	it("giữ nguyên logical ID của tài nguyên đã deploy", () => {
		const ids = Object.keys(template.toJSON().Resources);
		expect(ids).toEqual(expect.arrayContaining(DEPLOYED_LOGICAL_IDS));
	});

	it("bucket private, mã hóa, giữ lại khi xóa stack", () => {
		template.hasResource("AWS::S3::Bucket", {
			DeletionPolicy: "Retain",
			Properties: {
				PublicAccessBlockConfiguration: {
					BlockPublicAcls: true,
					BlockPublicPolicy: true,
					IgnorePublicAcls: true,
					RestrictPublicBuckets: true,
				},
				BucketEncryption: {
					ServerSideEncryptionConfiguration: [
						{ ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } },
					],
				},
			},
		});
	});

	it("CloudFront dùng domain, chứng chỉ có sẵn và OAC", () => {
		template.resourceCountIs("AWS::CloudFront::OriginAccessControl", 1);
		template.hasResourceProperties("AWS::CloudFront::Distribution", {
			DistributionConfig: Match.objectLike({
				Aliases: [config.domainName],
				DefaultRootObject: "index.html",
				PriceClass: "PriceClass_200",
				ViewerCertificate: {
					AcmCertificateArn: config.certificateArn,
					MinimumProtocolVersion: "TLSv1.2_2021",
					SslSupportMethod: "sni-only",
				},
				DefaultCacheBehavior: Match.objectLike({
					ViewerProtocolPolicy: "redirect-to-https",
					FunctionAssociations: [
						Match.objectLike({ EventType: "viewer-request" }),
					],
				}),
				CustomErrorResponses: [
					Match.objectLike({ ErrorCode: 403, ResponsePagePath: "/404.html" }),
					Match.objectLike({ ErrorCode: 404, ResponsePagePath: "/404.html" }),
				],
			}),
		});
	});

	it("không tạo chứng chỉ ACM hay SES (tạo tay trên console)", () => {
		template.resourceCountIs("AWS::CertificateManager::Certificate", 0);
		template.resourceCountIs("AWS::SES::EmailIdentity", 0);
	});

	it("CloudFront Function rewrite thư mục sang index.html", () => {
		template.hasResourceProperties("AWS::CloudFront::Function", {
			FunctionConfig: Match.objectLike({ Runtime: "cloudfront-js-2.0" }),
			FunctionCode: Match.stringLikeRegexp("index\\.html"),
		});
	});

	it("BucketDeployment prune và invalidate toàn bộ", () => {
		template.hasResourceProperties("Custom::CDKBucketDeployment", {
			Prune: true,
			DistributionPaths: ["/*"],
		});
	});

	it("chưa truyền API thì không có behavior /api/* (template như trước)", () => {
		template.hasResourceProperties("AWS::CloudFront::Distribution", {
			DistributionConfig: Match.objectLike({ CacheBehaviors: Match.absent() }),
		});
	});

	it("báo lỗi rõ khi chưa build web", () => {
		const app = new cdk.App();
		expect(
			() =>
				new WebStack(app, "Missing", {
					siteDir: path.join(__dirname, "fixtures/khong-ton-tai"),
				}),
		).toThrow(/Chưa có/);
	});
});

describe("LinkWatch-Web + behavior /api/*", () => {
	let template: Template;
	const API_DOMAIN = "abc123.execute-api.ap-southeast-1.amazonaws.com";

	beforeAll(() => {
		const app = new cdk.App();
		const stack = new WebStack(app, "LinkWatch-Web", {
			env: { account: config.account, region: config.region },
			siteDir: path.join(__dirname, "fixtures/site"),
			apiOriginDomain: API_DOMAIN,
		});
		template = Template.fromStack(stack);
	});

	it("vẫn giữ nguyên logical ID của tài nguyên đã deploy", () => {
		const ids = Object.keys(template.toJSON().Resources);
		expect(ids).toEqual(expect.arrayContaining(DEPLOYED_LOGICAL_IDS));
	});

	it("/api/* → API Gateway: không cache, mọi phương thức, chuyển header trừ Host, HTTPS", () => {
		template.hasResourceProperties("AWS::CloudFront::Distribution", {
			DistributionConfig: Match.objectLike({
				CacheBehaviors: [
					Match.objectLike({
						PathPattern: "/api/*",
						// Managed-CachingDisabled và Managed-AllViewerExceptHostHeader
						CachePolicyId: "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
						OriginRequestPolicyId: "b689b0a8-53d0-40ab-baf2-68738e2966ac",
						AllowedMethods: [
							"GET",
							"HEAD",
							"OPTIONS",
							"PUT",
							"PATCH",
							"POST",
							"DELETE",
						],
						ViewerProtocolPolicy: "https-only",
						FunctionAssociations: Match.absent(),
					}),
				],
				Origins: Match.arrayWith([
					Match.objectLike({
						DomainName: API_DOMAIN,
						CustomOriginConfig: Match.objectLike({
							OriginProtocolPolicy: "https-only",
						}),
					}),
				]),
			}),
		});
	});

	it("behavior mặc định (web tĩnh) không đổi: vẫn cache và rewrite index.html", () => {
		template.hasResourceProperties("AWS::CloudFront::Distribution", {
			DistributionConfig: Match.objectLike({
				DefaultCacheBehavior: Match.objectLike({
					CachePolicyId: "658327ea-f89d-4fab-a63d-7e88639e58f6",
					FunctionAssociations: [
						Match.objectLike({ EventType: "viewer-request" }),
					],
				}),
			}),
		});
	});
});
