import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as cdk from "aws-cdk-lib/core";
import type { Construct } from "constructs";
import { config } from "./config";

/** Table name for scripts and ops tools (SSM Standard, free). */
export const TABLE_NAME_PARAM = "/linkwatch/table-name";

const S = dynamodb.AttributeType.STRING;

/**
 * SRS 6.2: one single-table DynamoDB table. Key/GSI names must match
 * packages/core/src/db/table.ts (checked by infra/test/data-stack.test.ts).
 * All of GSI1–3 and Streams are created up front because each table update can add only one GSI.
 */
export class DataStack extends cdk.Stack {
	readonly table: dynamodb.Table;
	/** Step 19b: links snapshot for the list screen (derived data, rebuilt every 5 minutes). */
	readonly snapshotBucket: s3.Bucket;

	constructor(scope: Construct, id: string, props?: cdk.StackProps) {
		super(scope, id, props);
		const cap = config.dynamodb;

		this.table = new dynamodb.Table(this, "Table", {
			partitionKey: { name: "pk", type: S },
			sortKey: { name: "sk", type: S },
			billingMode: dynamodb.BillingMode.PROVISIONED,
			readCapacity: cap.table.read,
			writeCapacity: cap.table.write,
			timeToLiveAttribute: "ttl",
			stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
			deletionProtection: true,
			removalPolicy: cdk.RemovalPolicy.RETAIN,
		});

		for (const name of ["gsi1", "gsi2", "gsi3"] as const) {
			this.table.addGlobalSecondaryIndex({
				indexName: name,
				partitionKey: { name: `${name}pk`, type: S },
				sortKey: { name: `${name}sk`, type: S },
				projectionType: dynamodb.ProjectionType.ALL,
				readCapacity: cap[name].read,
				writeCapacity: cap[name].write,
			});
		}

		new ssm.StringParameter(this, "TableNameParam", {
			parameterName: TABLE_NAME_PARAM,
			stringValue: this.table.tableName,
			description: "LinkWatch DynamoDB table name",
		});

		// Private: read only through the API (Cognito), written only by the Dispatcher.
		this.snapshotBucket = new s3.Bucket(this, "SnapshotBucket", {
			blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
			encryption: s3.BucketEncryption.S3_MANAGED,
			enforceSSL: true,
			// Derived data: nothing to keep. RETAIN avoids an auto-delete custom resource.
			removalPolicy: cdk.RemovalPolicy.RETAIN,
			lifecycleRules: [{ noncurrentVersionExpiration: cdk.Duration.days(1) }],
		});

		new cdk.CfnOutput(this, "TableName", { value: this.table.tableName });
	}
}
