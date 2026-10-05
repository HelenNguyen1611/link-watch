import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Entity } from "electrodb";
import { IncidentState, IncidentType } from "../../schema/enums";

/** FR-37 / FR-42 / FR-04: why an incident was closed (`link_deleted`: no recovery email). */
export const CLOSED_REASONS = [
	"recovered",
	"verified_fix",
	"link_deleted",
] as const;

/**
 * SRS 6.2: Incident — PK LINK#<linkId>, SK INC#<openedAt>; kept forever (NFR-08, no TTL).
 * GSI2: pk = INC#<state>, sk = <openedAt>#<linkId> → list open incidents oldest first (FR-19, FR-23).
 * Domain and URL are copied in so emails and the incident list need no extra reads.
 */
export function incidentEntity(client: DynamoDBDocumentClient, table: string) {
	return new Entity(
		{
			model: { entity: "incident", version: "1", service: "linkwatch" },
			attributes: {
				linkId: { type: "string", required: true, readOnly: true },
				openedAt: { type: "string", required: true, readOnly: true },
				domain: { type: "string", required: true, readOnly: true },
				url: { type: "string", required: true },
				type: { type: IncidentType.options, required: true },
				state: { type: IncidentState.options, required: true, default: "open" },
				httpCode: { type: "number" },
				errorType: { type: "string" },
				closedAt: { type: "string" },
				closedReason: { type: CLOSED_REASONS },
				/** AC-07: from openedAt to the successful check. */
				downtimeMs: { type: "number" },
				/** FR-19: Acknowledge. */
				ackedBy: { type: "string" },
				ackedAt: { type: "string" },
				note: { type: "string" },
				/** FR-21: the incident email went out; only then is a recovery email sent. */
				downNotifiedAt: { type: "string" },
				/** FR-21: the recovery email went out (a redelivered flush does not resend it). */
				recoveryNotifiedAt: { type: "string" },
				/** FR-36: who reported it fixed and when (while Verifying; kept for the verify-failed email). */
				verifyingBy: { type: "string" },
				verifyingClaimAt: { type: "string" },
				/** FR-37: "Fixed by <email>" when a verification closed it. */
				closedBy: { type: "string" },
				/** FR-38: note after a claim whose checks all failed. */
				claimNote: { type: "string" },
				/** FR-23: last reminder email sent. */
				lastReminderAt: { type: "string" },
			},
			indexes: {
				primary: {
					pk: {
						field: "pk",
						composite: ["linkId"],
						template: "LINK#${linkId}",
						casing: "none",
					},
					sk: {
						field: "sk",
						composite: ["openedAt"],
						template: "INC#${openedAt}",
						casing: "none",
					},
				},
				byState: {
					index: "gsi2",
					pk: {
						field: "gsi2pk",
						composite: ["state"],
						template: "INC#${state}",
						casing: "none",
					},
					sk: {
						field: "gsi2sk",
						composite: ["openedAt", "linkId"],
						template: "${openedAt}#${linkId}",
						casing: "none",
					},
				},
			},
		},
		{ client, table },
	);
}
