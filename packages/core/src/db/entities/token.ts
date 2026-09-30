import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Entity } from "electrodb";

/**
 * FR-33 / FR-34: "Fixed — check again" link token — PK TOKEN#<sha256(token)>, SK META.
 * Only the hash is stored; tied to the recipient and to one incident (link button) or several
 * (group button of a grouped email). DynamoDB TTL removes it after 7 days.
 */
export function tokenEntity(client: DynamoDBDocumentClient, table: string) {
	return new Entity(
		{
			model: { entity: "token", version: "1", service: "linkwatch" },
			attributes: {
				tokenHash: { type: "string", required: true, readOnly: true },
				incidentIds: {
					type: "list",
					items: { type: "string" },
					required: true,
				},
				recipientEmail: { type: "string", required: true },
				issuedAt: { type: "string", required: true },
				ttl: { type: "number", required: true },
			},
			indexes: {
				primary: {
					pk: {
						field: "pk",
						composite: ["tokenHash"],
						template: "TOKEN#${tokenHash}",
						casing: "none",
					},
					sk: { field: "sk", composite: [], template: "META", casing: "none" },
				},
			},
		},
		{ client, table },
	);
}
