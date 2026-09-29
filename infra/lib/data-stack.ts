import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as cdk from "aws-cdk-lib/core";
import type { Construct } from "constructs";
import { config } from "./config";

/** Tên bảng cho script/công cụ vận hành (SSM Standard, miễn phí). */
export const TABLE_NAME_PARAM = "/linkwatch/table-name";

const S = dynamodb.AttributeType.STRING;

/**
 * SRS 6.2: một bảng DynamoDB single-table. Tên key/GSI phải khớp
 * packages/core/src/db/table.ts (test infra/test/data-stack.test.ts kiểm tra).
 * Tạo đủ GSI1–3 và bật Streams ngay vì mỗi lần cập nhật bảng chỉ thêm được 1 GSI.
 */
export class DataStack extends cdk.Stack {
	readonly table: dynamodb.Table;

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
			description: "Tên bảng DynamoDB của LinkWatch",
		});

		new cdk.CfnOutput(this, "TableName", { value: this.table.tableName });
	}
}
