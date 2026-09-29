import type { CreateTableCommandInput } from "@aws-sdk/client-dynamodb";

/**
 * SRS 6.2: một bảng DynamoDB (single-table).
 * - gsi1 "due": pk = "DUE", sk = next_run_at — Dispatcher lấy link đến hạn (thưa: link tạm dừng/xóa không có next_run_at).
 * - gsi2: pk = state, sk = opened_at — incident đang mở (Bước 9b).
 * - gsi3 "byType": pk = loại thực thể, sk = id — tra link theo id và liệt kê mọi link/domain.
 * CDK (Bước 35) phải khai báo đúng các tên này.
 */
export const KEY_ATTRIBUTES = [
	"pk",
	"sk",
	"gsi1pk",
	"gsi1sk",
	"gsi2pk",
	"gsi2sk",
	"gsi3pk",
	"gsi3sk",
] as const;
export const GSI_NAMES = ["gsi1", "gsi2", "gsi3"] as const;

export function tableDefinition(tableName: string): CreateTableCommandInput {
	return {
		TableName: tableName,
		BillingMode: "PAY_PER_REQUEST",
		AttributeDefinitions: KEY_ATTRIBUTES.map((AttributeName) => ({
			AttributeName,
			AttributeType: "S",
		})),
		KeySchema: [
			{ AttributeName: "pk", KeyType: "HASH" },
			{ AttributeName: "sk", KeyType: "RANGE" },
		],
		GlobalSecondaryIndexes: GSI_NAMES.map((IndexName) => ({
			IndexName,
			KeySchema: [
				{ AttributeName: `${IndexName}pk`, KeyType: "HASH" },
				{ AttributeName: `${IndexName}sk`, KeyType: "RANGE" },
			],
			Projection: { ProjectionType: "ALL" },
		})),
	};
}
