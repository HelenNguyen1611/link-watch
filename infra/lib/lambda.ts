import * as path from "node:path";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as cdk from "aws-cdk-lib/core";
import type { Construct } from "constructs";

const REPO_ROOT = path.join(__dirname, "../..");

export type LinkWatchFunctionProps = {
	/** Entry path relative to the repo root, e.g. services/checker/src/index.ts */
	entry: string;
	timeout: cdk.Duration;
	memorySize?: number;
	reservedConcurrentExecutions?: number;
	environment?: Record<string, string>;
};

/**
 * Standard LinkWatch Lambda (SRS 3.4–3.5): Node.js 22, arm64, outside a VPC (no NAT),
 * bundled with esbuild from the pnpm monorepo, logs kept for 14 days.
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
				// AWS SDK v3 ships with the Node 22 runtime.
				externalModules: ["@aws-sdk/*"],
			},
		});
	}
}
