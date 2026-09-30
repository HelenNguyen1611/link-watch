import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Entity } from "electrodb";

/**
 * FR-36 / FR-41: a "fixed — check again" report — PK INC#<incidentId>, SK CLAIM#<claimedAt>.
 * Kept with the incident (forever, NFR-08); listed as the incident timeline.
 */
export function claimEntity(client: DynamoDBDocumentClient, table: string) {
	return new Entity(
		{
			model: { entity: "claim", version: "1", service: "linkwatch" },
			attributes: {
				incidentId: { type: "string", required: true, readOnly: true },
				claimedAt: { type: "string", required: true, readOnly: true },
				linkId: { type: "string", required: true },
				domain: { type: "string", required: true },
				byEmail: { type: "string", required: true },
				channel: { type: ["email", "app"] as const, required: true },
				note: { type: "string" },
				outcome: {
					type: ["pending", "fixed", "still_failing"] as const,
					required: true,
					default: "pending",
				},
				attempts: {
					type: "list",
					default: () => [],
					items: {
						type: "map",
						properties: {
							attempt: { type: "number", required: true },
							at: { type: "string", required: true },
							result: { type: "string", required: true },
							httpCode: { type: "number" },
							errorType: { type: "string" },
						},
					},
				},
				finishedAt: { type: "string" },
				/** FR-38: the still-failing email went out (a redelivered stream event does not resend it). */
				notifiedAt: { type: "string" },
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
						composite: ["claimedAt"],
						template: "CLAIM#${claimedAt}",
						casing: "none",
					},
				},
			},
		},
		{ client, table },
	);
}
