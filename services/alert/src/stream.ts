import { unmarshall } from "@aws-sdk/util-dynamodb";
import { incidentId } from "@linkwatch/core";
import type { NotificationEventInput } from "@linkwatch/core/usecases";
import type { DynamoDBRecord } from "aws-lambda";

/** ElectroDB stores the entity name in this attribute (used by the Streams filter, step 36b). */
export const ENTITY_ATTRIBUTE = "__edb_e__";

type IncidentImage = {
	[ENTITY_ATTRIBUTE]?: string;
	linkId?: string;
	openedAt?: string;
	domain?: string;
	state?: string;
	closedAt?: string;
};

const image = (
	raw: DynamoDBRecord["dynamodb"],
	key: "NewImage" | "OldImage",
) => {
	const value = raw?.[key];
	return value
		? (unmarshall(value as Parameters<typeof unmarshall>[0]) as IncidentImage)
		: undefined;
};

/**
 * FR-21: turns one Streams record into a notification event —
 * a new incident → `down`; an incident that just became closed → `recovery`.
 */
export function toNotificationEvent(
	record: DynamoDBRecord,
): NotificationEventInput | undefined {
	const next = image(record.dynamodb, "NewImage");
	if (next?.[ENTITY_ATTRIBUTE] !== "incident") return undefined;
	const { linkId, openedAt, domain } = next;
	if (!linkId || !openedAt || !domain) return undefined;
	const id = incidentId(linkId, openedAt);

	if (record.eventName === "INSERT" && next.state !== "closed")
		return { kind: "down", domain, incidentId: id, at: openedAt };

	if (record.eventName === "MODIFY" && next.state === "closed") {
		const prev = image(record.dynamodb, "OldImage");
		if (prev?.state === "closed") return undefined;
		return {
			kind: "recovery",
			domain,
			incidentId: id,
			at: next.closedAt ?? openedAt,
		};
	}
	return undefined;
}
