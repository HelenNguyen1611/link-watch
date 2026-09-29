import type { CreateTableCommandInput } from "@aws-sdk/client-dynamodb";

/**
 * SRS 6.2: one DynamoDB table (single-table design).
 * - gsi1 "due": pk = "DUE", sk = next_run_at — the Dispatcher fetches due links (sparse: paused/deleted links have no next_run_at).
 * - gsi2: pk = state, sk = opened_at — open incidents (step 9b).
 * - gsi3 "byType": pk = entity type, sk = id — look up a link by id and list every link/domain.
 * CDK (step 35) must declare exactly these names.
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
