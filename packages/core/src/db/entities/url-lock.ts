import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Entity } from "electrodb";

/**
 * FR-02: khóa chống trùng URL — PK URL#<sha256(url)>, SK META.
 * Ghi cùng Link trong 1 transaction; xóa khi link bị xóa mềm để thêm lại được.
 * Dùng sha256 vì khóa phân vùng DynamoDB tối đa 2.048 byte.
 */
export function urlLockEntity(client: DynamoDBDocumentClient, table: string) {
	return new Entity(
		{
			model: { entity: "urlLock", version: "1", service: "linkwatch" },
			attributes: {
				urlHash: { type: "string", required: true, readOnly: true },
				url: { type: "string", required: true },
				linkId: { type: "string", required: true },
				domain: { type: "string", required: true },
			},
			indexes: {
				primary: {
					pk: {
						field: "pk",
						composite: ["urlHash"],
						template: "URL#${urlHash}",
						casing: "none",
					},
					sk: { field: "sk", composite: [], template: "META", casing: "none" },
				},
			},
		},
		{ client, table },
	);
}
