import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Entity } from "electrodb";

/** SRS 6.2: kinds of email logged per incident. */
export const NOTIFICATION_KINDS = [
	"down",
	"recovery",
	"reminder",
	"verify_failed",
] as const;
export type NotificationLogKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_STATUSES = ["sent", "failed"] as const;

/**
 * FR-25: log of every email sent — PK INC#<incidentId>, SK MAIL#<sentAt>#<to>.
 * One row per incident and recipient: a grouped email (FR-22) writes one row per incident it lists.
 */
export function notificationEntity(
	client: DynamoDBDocumentClient,
	table: string,
) {
	return new Entity(
		{
			model: { entity: "notification", version: "1", service: "linkwatch" },
			attributes: {
				incidentId: { type: "string", required: true, readOnly: true },
				sentAt: { type: "string", required: true, readOnly: true },
				to: { type: "string", required: true, readOnly: true },
				kind: { type: NOTIFICATION_KINDS, required: true },
				status: { type: NOTIFICATION_STATUSES, required: true },
				/** FR-25: number of retries after the first attempt (max 3). */
				retries: { type: "number", default: 0 },
				subject: { type: "string" },
				messageId: { type: "string" },
				error: { type: "string" },
			},
			indexes: {
				byIncident: {
					pk: {
						field: "pk",
						composite: ["incidentId"],
						template: "INC#${incidentId}",
						casing: "none",
					},
					sk: {
						field: "sk",
						composite: ["sentAt", "to"],
						template: "MAIL#${sentAt}#${to}",
						casing: "none",
					},
				},
			},
		},
		{ client, table },
	);
}
