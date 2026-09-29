import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Entity } from "electrodb";
import { CheckErrorType, CheckResultKind } from "../../schema/enums";

/** NFR-08: chi tiết check giữ 90 ngày (DynamoDB TTL xóa tự động). */
export const CHECK_TTL_DAYS = 90;

/** Epoch giây mà DynamoDB TTL xóa bản ghi check. */
export function checkTtl(checkedAt: string): number {
	return Math.floor(Date.parse(checkedAt) / 1000) + CHECK_TTL_DAYS * 86_400;
}

/** SRS 6.2 / FR-17: Kết quả check — PK LINK#<id>, SK CHECK#<thời điểm>. */
export function checkEntity(client: DynamoDBDocumentClient, table: string) {
	return new Entity(
		{
			model: { entity: "check", version: "1", service: "linkwatch" },
			attributes: {
				linkId: { type: "string", required: true, readOnly: true },
				checkedAt: { type: "string", required: true, readOnly: true },
				result: { type: CheckResultKind.options, required: true },
				httpCode: { type: "number" },
				responseMs: { type: "number", required: true },
				finalUrl: { type: "string" },
				errorType: { type: CheckErrorType.options },
				errorMessage: { type: "string" },
				sslExpiresAt: { type: "string" },
				ttl: {
					type: "number",
					readOnly: true,
					watch: ["checkedAt"],
					set: (_, item) => checkTtl(item.checkedAt as string),
				},
			},
			indexes: {
				byLink: {
					pk: {
						field: "pk",
						composite: ["linkId"],
						template: "LINK#${linkId}",
						casing: "none",
					},
					sk: {
						field: "sk",
						composite: ["checkedAt"],
						template: "CHECK#${checkedAt}",
						casing: "none",
					},
				},
			},
		},
		{ client, table },
	);
}
