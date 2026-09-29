import * as path from "node:path";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as cdk from "aws-cdk-lib/core";
import type { Construct } from "constructs";

const REPO_ROOT = path.join(__dirname, "../..");

export type LinkWatchFunctionProps = {
	/** Đường dẫn entry tính từ gốc repo, vd. services/checker/src/index.ts */
	entry: string;
	timeout: cdk.Duration;
	memorySize?: number;
	reservedConcurrentExecutions?: number;
	environment?: Record<string, string>;
};

/**
 * Lambda chuẩn của LinkWatch (SRS 3.4–3.5): Node.js 22, arm64, ngoài VPC (không NAT),
 * đóng gói esbuild từ monorepo pnpm, log giữ 14 ngày.
 */
export class LinkWatchFunction extends nodejs.NodejsFunction {
	constructor(scope: Construct, id: string, props: LinkWatchFunctionProps) {
		const logGroup = new logs.LogGroup(scope, `${id}Logs`, {
			retention: logs.RetentionDays.TWO_WEEKS,
			removalPolicy: cdk.RemovalPolicy.DESTROY,
		});
		super(scope, id, {
			entry: path.join(REPO_ROOT, props.entry),
			projectRoot: REPO_ROOT,
			depsLockFilePath: path.join(REPO_ROOT, "pnpm-lock.yaml"),
			runtime: lambda.Runtime.NODEJS_22_X,
			architecture: lambda.Architecture.ARM_64,
			memorySize: props.memorySize ?? 256,
			timeout: props.timeout,
			reservedConcurrentExecutions: props.reservedConcurrentExecutions,
			logGroup,
			environment: {
				NODE_OPTIONS: "--enable-source-maps",
				...props.environment,
			},
			bundling: {
				target: "node22",
				minify: true,
				sourceMap: true,
				// AWS SDK v3 có sẵn trong runtime Node 22.
				externalModules: ["@aws-sdk/*"],
			},
		});
	}
}
