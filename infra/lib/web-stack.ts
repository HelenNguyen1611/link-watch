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
 * Web UI: S3 (private) + CloudFront (HTTPS, watch.hueai.net).
 * The Next.js static export (apps/web/out) is uploaded to S3 on every deploy.
 * /api/* is routed to API Gateway on the same distribution (step 37a).
 */
export interface WebStackProps extends cdk.StackProps {
	/** Static site directory; defaults to apps/web/out. Tests pass a fixture so no web build is needed. */
	siteDir?: string;
	/** execute-api domain of LinkWatch-Api; when set, adds the /api/* behavior (step 37a). */
	apiOriginDomain?: string;
	/**
	 * FR-28: Cognito ids written to /auth-config.json at deploy time — the static export is
	 * built before `cdk deploy` creates the User Pool, so the web app reads them at runtime.
	 */
	auth?: { userPoolId: string; userPoolClientId: string };
}

/** Path of the runtime auth config read by apps/web (src/lib/auth.ts). */
export const AUTH_CONFIG_PATH = "auth-config.json";

/** CloudFront Functions: maximum code size. */
const MAX_FUNCTION_CODE_BYTES = 10 * 1024;

/** Every page of the static export as a URI after the index rewrite, e.g. /links/index.html. */
export function listPages(siteDir: string): string[] {
	const pages: string[] = [];
	const walk = (dir: string) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.name.endsWith(".html"))
				pages.push(
					`/${path.relative(siteDir, full).split(path.sep).join("/")}`,
				);
		}
	};
	walk(siteDir);
	return pages.sort();
}

/**
 * Viewer-request function of the static site (default behavior only):
 * 1. trailingSlash export: /links/ and /links → /links/index.html;
 * 2. step 37c: a page URI missing from the build → /404.html. This replaces the distribution-wide
 *    `errorResponses`, which also rewrote /api/* 403/404 JSON into the HTML page. The 404 page is
 *    served with status 200 (a viewer-request function cannot change the origin status).
 */
export function siteRewriteCode(pages: readonly string[]): string {
	const known = JSON.stringify(Object.fromEntries(pages.map((p) => [p, 1])));
	const notFound = pages.includes("/404.html") ? "'/404.html'" : "null";
	const code = `var PAGES = ${known};
var NOT_FOUND = ${notFound};
function handler(event) {
  var req = event.request;
  var uri = req.uri;
  if (uri.endsWith('/')) { uri = uri + 'index.html'; }
  else if (uri.lastIndexOf('.') < uri.lastIndexOf('/')) { uri = uri + '/index.html'; }
  if (NOT_FOUND && uri.endsWith('.html') && !PAGES[uri]) { uri = NOT_FOUND; }
  req.uri = uri;
  return req;
}`;
	if (Buffer.byteLength(code) > MAX_FUNCTION_CODE_BYTES)
		throw new Error(
			`CloudFront Function code is ${Buffer.byteLength(code)} bytes (max ${MAX_FUNCTION_CODE_BYTES}): too many pages`,
		);
	return code;
}

export class WebStack extends cdk.Stack {
	constructor(scope: Construct, id: string, props?: WebStackProps) {
		super(scope, id, props);

		const siteDir =
			props?.siteDir ?? path.join(__dirname, "../../apps/web/out");
		if (!fs.existsSync(siteDir)) {
			throw new Error(
				`Missing ${siteDir}. Run "pnpm build" at the repo root before deploying.`,
			);
		}

		const bucket = new s3.Bucket(this, "SiteBucket", {
			blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
			encryption: s3.BucketEncryption.S3_MANAGED,
			enforceSSL: true,
			removalPolicy: cdk.RemovalPolicy.RETAIN,
		});

		// Static export uses trailingSlash: /links/ → /links/index.html; unknown pages → /404.html.
		const rewrite = new cloudfront.Function(this, "IndexRewrite", {
			runtime: cloudfront.FunctionRuntime.JS_2_0,
			code: cloudfront.FunctionCode.fromInline(
				siteRewriteCode(listPages(siteDir)),
			),
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
			priceClass: cloudfront.PriceClass.PRICE_CLASS_200, // includes Asian edge locations
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
			// No errorResponses (step 37c): they apply to every behavior and replaced the API's
			// 403/404 JSON with the HTML page. Unknown pages are handled by the function above.
		});

		// /api/* → API Gateway: same origin as the web app, so no CORS. No caching; forward every
		// header except Host (API Gateway needs its own Host) so the Authorization header reaches the JWT authorizer.
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

		const sources = [s3deploy.Source.asset(siteDir)];
		if (props?.auth)
			sources.push(
				s3deploy.Source.jsonData(AUTH_CONFIG_PATH, {
					region: this.region,
					userPoolId: props.auth.userPoolId,
					userPoolClientId: props.auth.userPoolClientId,
				}),
			);
		new s3deploy.BucketDeployment(this, "DeploySite", {
			sources,
			destinationBucket: bucket,
			distribution,
			distributionPaths: ["/*"],
			prune: true,
			memoryLimit: 512,
		});

		new cdk.CfnOutput(this, "DistributionDomainName", {
			value: distribution.distributionDomainName,
			description: `Create CNAME "watch" → this value on Cloudflare (DNS only)`,
		});
		new cdk.CfnOutput(this, "SiteUrl", {
			value: `https://${config.domainName}`,
		});
	}
}
