import * as fs from "node:fs";
import * as path from "node:path";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as cdk from "aws-cdk-lib/core";
import type { Construct } from "constructs";
import { config } from "./config";

/**
 * Giao diện web: S3 (private) + CloudFront (HTTPS, watch.hueai.net).
 * Next.js static export (apps/web/out) được upload lên S3 mỗi lần deploy.
 * Sau này sẽ thêm behavior /api/* → API Gateway vào distribution này.
 */
export interface WebStackProps extends cdk.StackProps {
	/** Thư mục site tĩnh; mặc định apps/web/out. Test truyền thư mục mẫu để không cần build web. */
	siteDir?: string;
	/** Domain execute-api của LinkWatch-Api; có thì thêm behavior /api/* (Bước 37a). */
	apiOriginDomain?: string;
}

export class WebStack extends cdk.Stack {
	constructor(scope: Construct, id: string, props?: WebStackProps) {
		super(scope, id, props);

		const siteDir =
			props?.siteDir ?? path.join(__dirname, "../../apps/web/out");
		if (!fs.existsSync(siteDir)) {
			throw new Error(
				`Chưa có ${siteDir}. Hãy chạy "pnpm build" ở thư mục gốc trước khi deploy.`,
			);
		}

		const bucket = new s3.Bucket(this, "SiteBucket", {
			blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
			encryption: s3.BucketEncryption.S3_MANAGED,
			enforceSSL: true,
			removalPolicy: cdk.RemovalPolicy.RETAIN,
		});

		// Static export dùng trailingSlash: /links/ → /links/index.html
		const rewrite = new cloudfront.Function(this, "IndexRewrite", {
			runtime: cloudfront.FunctionRuntime.JS_2_0,
			code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var req = event.request;
  var uri = req.uri;
  if (uri.endsWith('/')) { req.uri = uri + 'index.html'; }
  else if (uri.lastIndexOf('.') < uri.lastIndexOf('/')) { req.uri = uri + '/index.html'; }
  return req;
}`),
		});

		const certificate = acm.Certificate.fromCertificateArn(
			this,
			"Cert",
			config.certificateArn,
		);

		const distribution = new cloudfront.Distribution(this, "Distribution", {
			domainNames: [config.domainName],
			certificate,
			defaultRootObject: "index.html",
			priceClass: cloudfront.PriceClass.PRICE_CLASS_200, // có edge châu Á
			minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
			httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
			defaultBehavior: {
				origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
				viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
				cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
				responseHeadersPolicy:
					cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
				functionAssociations: [
					{
						function: rewrite,
						eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
					},
				],
			},
			errorResponses: [
				{
					httpStatus: 403,
					responseHttpStatus: 404,
					responsePagePath: "/404.html",
					ttl: cdk.Duration.minutes(5),
				},
				{
					httpStatus: 404,
					responseHttpStatus: 404,
					responsePagePath: "/404.html",
					ttl: cdk.Duration.minutes(5),
				},
			],
		});

		// /api/* → API Gateway: cùng origin với web nên không cần CORS. Không cache, chuyển mọi
		// header trừ Host (API Gateway cần Host của chính nó) để header khóa API tới được Lambda.
		if (props?.apiOriginDomain) {
			distribution.addBehavior(
				"/api/*",
				new origins.HttpOrigin(props.apiOriginDomain, {
					protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
				}),
				{
					viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
					allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
					cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
					originRequestPolicy:
						cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
				},
			);
		}

		new s3deploy.BucketDeployment(this, "DeploySite", {
			sources: [s3deploy.Source.asset(siteDir)],
			destinationBucket: bucket,
			distribution,
			distributionPaths: ["/*"],
			prune: true,
			memoryLimit: 512,
		});

		new cdk.CfnOutput(this, "DistributionDomainName", {
			value: distribution.distributionDomainName,
			description: `Tạo CNAME "watch" → giá trị này trên Cloudflare (DNS only)`,
		});
		new cdk.CfnOutput(this, "SiteUrl", {
			value: `https://${config.domainName}`,
		});
	}
}
