import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Entity } from "electrodb";
import { normalizeEmail } from "../../recipients";

/** FR-20: a recipient belongs to a domain or to one link. */
export const RECIPIENT_SCOPES = ["DOMAIN", "LINK"] as const;
export type RecipientScope = (typeof RECIPIENT_SCOPES)[number];

const now = () => new Date().toISOString();

/**
 * SRS 6.2: Recipient — PK DOMAIN#<domain> or LINK#<id>, SK RCP#<email>.
 * `target` = domain name (scope DOMAIN) or link id (scope LINK). Emails are stored
 * normalized (trimmed, lowercased) so the key deduplicates them (FR-20).
 */
export function recipientEntity(client: DynamoDBDocumentClient, table: string) {
	return new Entity(
		{
			model: { entity: "recipient", version: "1", service: "linkwatch" },
			attributes: {
				scope: { type: RECIPIENT_SCOPES, required: true, readOnly: true },
				target: { type: "string", required: true, readOnly: true },
				email: {
					type: "string",
					required: true,
					readOnly: true,
					set: (email) => (email === undefined ? email : normalizeEmail(email)),
				},
				name: { type: "string" },
				createdAt: { type: "string", readOnly: true, default: now },
			},
			indexes: {
				byTarget: {
					pk: {
						field: "pk",
						composite: ["scope", "target"],
						template: "${scope}#${target}",
						casing: "none",
					},
					sk: {
						field: "sk",
						composite: ["email"],
						template: "RCP#${email}",
						casing: "none",
					},
				},
			},
		},
		{ client, table },
	);
}
