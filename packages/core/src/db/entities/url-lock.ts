import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Entity } from "electrodb";

/**
 * FR-02: URL uniqueness lock — PK URL#<sha256(url)>, SK META.
 * Written with the Link in one transaction; removed when the link is soft-deleted so it can be re-added.
 * sha256 because a DynamoDB partition key is at most 2,048 bytes.
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
